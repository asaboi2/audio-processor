const { S3Client, ListObjectsV2Command, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');

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

// Function to stream file from Spaces to local
const streamToBuffer = async (stream) => {
    const chunks = [];
    for await (const chunk of stream) {
        chunks.push(chunk);
    }
    return Buffer.concat(chunks);
};

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
        data.Contents.forEach(file => console.log(file.Key));

        for (const file of data.Contents) {
            const fileName = path.basename(file.Key);
            if (fileName.endsWith('.mp3')) {
                console.log(`Processing file: ${fileName}`);

                // Download the file
                const mp3Data = await s3.send(new GetObjectCommand({
                    Bucket: bucketName,
                    Key: file.Key,
                }));

                console.log(`Downloaded file: ${fileName}`);

                // Simulate conversion
                const oggFileName = fileName.replace('.mp3', '.ogg');
                const oggFilePath = path.join(__dirname, oggFileName);

                fs.writeFileSync(oggFilePath, await streamToBuffer(mp3Data.Body));

                console.log(`Converted ${fileName} to ${oggFileName}`);

                // Upload the OGG file to the output folder
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
