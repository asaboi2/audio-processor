const AWS = require('@aws-sdk/client-s3');
const fs = require('fs');
const { exec } = require('child_process');
const axios = require('axios');

// Load environment variables
const spacesKey = process.env.SPACES_KEY;
const spacesSecret = process.env.SPACES_SECRET;
const spacesEndpoint = process.env.SPACES_ENDPOINT || 'nyc3.digitaloceanspaces.com';
const bucketName = process.env.BUCKET_NAME;

const s3 = new AWS.S3({
    credentials: {
        accessKeyId: spacesKey,
        secretAccessKey: spacesSecret
    },
    endpoint: `https://${spacesEndpoint}`,
    region: 'nyc3'
});

// Function to convert MP3 to OGG
async function convertMp3ToOgg(filePath, outputFilePath) {
    return new Promise((resolve, reject) => {
        exec(`ffmpeg -i ${filePath} -vn -map_metadata -1 -ac 1 -c:a libvorbis -q:a 0.1 ${outputFilePath}`, (error) => {
            if (error) return reject(error);
            resolve();
        });
    });
}

// Function to upload to Spaces
async function uploadToSpaces(fileName, filePath) {
    const fileContent = fs.readFileSync(filePath);
    await s3.putObject({
        Bucket: bucketName,
        Key: `ogg/${fileName}`,
        Body: fileContent,
        ContentType: 'audio/ogg'
    });
}

// Main function to check for new MP3 files and convert them
async function checkForNewFiles() {
    console.log('Checking for new MP3 files...');
    
    try {
        const files = await s3.listObjectsV2({ Bucket: bucketName, Prefix: 'mp3/' });
        if (!files.Contents || files.Contents.length === 0) {
            console.log('No new MP3 files found.');
            return;
        }

        for (const file of files.Contents) {
            if (file.Key.endsWith('.mp3')) {
                console.log(`Processing file: ${file.Key}`);
                const fileName = file.Key.split('/').pop();
                const tempMp3Path = `/tmp/${fileName}`;
                const tempOggPath = `/tmp/${fileName.replace('.mp3', '.ogg')}`;

                // Download the MP3
                const mp3File = await s3.getObject({ Bucket: bucketName, Key: file.Key });
                fs.writeFileSync(tempMp3Path, mp3File.Body);

                // Convert to OGG
                console.log(`Converting ${fileName} to OGG...`);
                await convertMp3ToOgg(tempMp3Path, tempOggPath);

                // Upload the OGG file
                const oggFileName = fileName.replace('.mp3', '.ogg');
                console.log(`Uploading ${oggFileName} to Spaces...`);
                await uploadToSpaces(oggFileName, tempOggPath);

                console.log(`File ${oggFileName} uploaded successfully.`);
            }
        }
    } catch (error) {
        console.error('Error processing files:', error);
    }
}

// Run the check every 20 seconds
setInterval(checkForNewFiles, 20000);
