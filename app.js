const { S3Client, ListObjectsV2Command, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { writeFile } = require('fs').promises;
const axios = require('axios');

// Set up Spaces credentials
const s3 = new S3Client({
    region: 'nyc3',
    endpoint: 'https://nyc3.digitaloceanspaces.com',
    credentials: {
        accessKeyId: process.env.SPACES_KEY,
        secretAccessKey: process.env.SPACES_SECRET,
    },
});

// Folder paths in the Space
const bucketName = 'audio-uploads-questworks';
const inputFolder = 'mp3/';
const outputFolder = 'ogg/';

// Your Zapier webhook URL
const webhookUrl = 'https://hooks.zapier.com/hooks/catch/20789352/282fw24/';

// In-memory cache to track processed files
const processedFiles = new Set();

// Function to stream file from Spaces to local
const streamToBuffer = async (stream) => {
    const chunks = [];
    for await (const chunk of stream) {
        chunks.push(chunk);
    }
    return Buffer.concat(chunks);
};

// Function to convert MP3 to OGG using FFmpeg with Vorbis codec
async function convertToOgg(inputBuffer, outputPath) {
    const tempInputPath = 'temp_input.mp3';
    await writeFile(tempInputPath, inputBuffer);

    console.log(`Starting FFmpeg conversion for: ${tempInputPath}`);

    const ffmpegCommand = `ffmpeg -i ${tempInputPath} -vn -map_metadata -1 -ac 1 -c:a libvorbis -q:a 0.5 -hide_banner -loglevel warning ${outputPath}`;

    return new Promise((resolve, reject) => {
        const process = exec(ffmpegCommand, (error, stdout, stderr) => {
            if (error) {
                console.error(`FFmpeg error: ${stderr}`);
                reject(`Conversion failed: ${stderr}`);
            } else {
                console.log(`FFmpeg output: ${stdout}`);
                resolve();
            }
        });

        process.stdout.on('data', (data) => {
            console.log(`FFmpeg Output: ${data}`);
        });

        process.stderr.on('data', (data) => {
            console.error(`FFmpeg Warning: ${data}`);
        });
    });
}

// Function to check for new MP3 files every 20 seconds
async function checkForNewFiles() {
    console.log("Checking for new MP3 files...");

    try {
        // List objects in the input folder
        const data = await s3.send(new ListObjectsV2Command({
            Bucket: bucketName,
            Prefix: inputFolder,
        }));

        const mp3Files = data.Contents?.filter(file => file.Key.endsWith('.mp3')) || [];

        if (mp3Files.length === 0) {
            console.log("No new MP3 files found.");
        } else {
            console.log("Files found in /mp3 folder:");
            mp3Files.forEach(file => console.log(file.Key));

            for (const file of mp3Files) {
                const fileName = path.basename(file.Key);
                if (!processedFiles.has(file.Key)) {
                    console.log(`Processing file: ${fileName}`);
                    processedFiles.add(file.Key);

                    const mp3Data = await s3.send(new GetObjectCommand({
                        Bucket: bucketName,
                        Key: file.Key,
                    }));

                    console.log(`Downloaded file: ${fileName}`);

                    const oggFileName = fileName.replace('.mp3', '.ogg');
                    const oggFilePath = path.join(__dirname, oggFileName);

                    await convertToOgg(await streamToBuffer(mp3Data.Body), oggFilePath);

                    console.log(`Converted ${fileName} to ${oggFileName}`);

                    // Upload the OGG file to the output folder in the Space
                    const oggFile = fs.readFileSync(oggFilePath);
                    await s3.send(new PutObjectCommand({
                        Bucket: bucketName,
                        Key: `${outputFolder}${oggFileName}`,
                        Body: oggFile,
                        ContentType: 'audio/ogg',
                    }));

                    console.log(`Uploaded ${oggFileName} to ${outputFolder}`);

                    // Send a POST request to the Zapier webhook with the OGG file
                    const oggFileBuffer = fs.readFileSync(oggFilePath);

                    await axios.post(webhookUrl, oggFileBuffer, {
                        headers: {
                            'Content-Type': 'audio/ogg',
                            'Content-Disposition': `attachment; filename="${oggFileName}"`,
                        },
                    });

                    console.log(`Webhook sent for: ${oggFileName}`);

                    // Clean up the local file
                    fs.unlinkSync(oggFilePath);
                }
            }
        }
    } catch (err) {
        console.error("Error processing files:", err);
    }

    // Check again in 20 seconds
    setTimeout(checkForNewFiles, 20000);
}

// Start the continuous file check
checkForNewFiles();
