const { S3Client, ListObjectsV2Command, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { writeFile } = require('fs').promises;

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
    // Write the input buffer to a temporary MP3 file
    const tempInputPath = 'temp_input.mp3';
    await writeFile(tempInputPath, inputBuffer);

    console.log(`Starting FFmpeg conversion for: ${tempInputPath}`);

    // Use the updated FFmpeg command with lower quality
    const ffmpegCommand = `ffmpeg -i ${tempInputPath} -vn -map_metadata -1 -ac 1 -c:a libvorbis -q:a 0.5 ${outputPath}`;

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
            console.log(`FFmpeg: ${data}`);
        });

        process.stderr.on('data', (data) => {
            console.error(`FFmpeg Error: ${data}`);
        });
    });
}

// Function to check for new MP3 files and convert them to OGG
async function checkForNewFiles() {
    console.log("Checking for new MP3 files...");

    try {
        // List objects in the input folder
        const data = await s3.send(new ListObjectsV2Command({
            Bucket: bucketName,
            Prefix: inputFolder,
        }));

        if (!data.Contents || data.Contents.length === 0) {
            console.log("No new files found.");
            return;
        }

        console.log("Files found in /mp3 folder:");
        data.Contents
            .filter(file => file.Key.endsWith('.mp3'))
            .forEach(file => console.log(file.Key));

        for (const file of data.Contents) {
            const fileName = path.basename(file.Key);
            if (fileName.endsWith('.mp3') && !processedFiles.has(file.Key)) {
                console.log(`Processing file: ${fileName}`);
                processedFiles.add(file.Key); // Mark file as processed

                // Download the MP3 file from the Space
                const mp3Data = await s3.send(new GetObjectCommand({
                    Bucket: bucketName,
                    Key: file.Key,
                }));

                console.log(`Downloaded file: ${fileName}`);

                // Convert the MP3 to OGG with custom FFmpeg parameters
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

                // Clean up the local file
                fs.unlinkSync(oggFilePath);
            }
        }
    } catch (err) {
        console.error("Error processing files:", err);
    }
}

// Run the function every 5 minutes
setInterval(checkForNewFiles, 5 * 60 * 1000);

// Run it once on startup
checkForNewFiles();
