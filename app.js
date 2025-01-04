const AWS = require('aws-sdk');
const fs = require('fs');
const path = require('path');

// Set up Spaces credentials
const spacesEndpoint = new AWS.Endpoint('nyc3.digitaloceanspaces.com');
const s3 = new AWS.S3({
    endpoint: spacesEndpoint,
    accessKeyId: process.env.SPACES_KEY,
    secretAccessKey: process.env.SPACES_SECRET,
});

// Folder paths in the Space
const bucketName = 'audio-uploads-questworks';
const inputFolder = 'mp3/';
const outputFolder = 'ogg/';

// Function to check for new MP3 files and convert them to OGG
async function checkForNewFiles() {
    console.log("Checking for new MP3 files...");

    try {
        // List objects in the input folder
        const data = await s3
            .listObjectsV2({
                Bucket: bucketName,
                Prefix: inputFolder,
            })
            .promise();

        if (!data.Contents || data.Contents.length === 0) {
            console.log("No new files found.");
            return;
        }

        for (const file of data.Contents) {
            const fileName = path.basename(file.Key);
            if (fileName.endsWith('.mp3')) {
                console.log(`Processing file: ${fileName}`);

                // Download the file
                const mp3File = await s3
                    .getObject({
                        Bucket: bucketName,
                        Key: file.Key,
                    })
                    .promise();

                // Simulate conversion (replace with actual conversion logic)
                const oggFileName = fileName.replace('.mp3', '.ogg');
                const oggFilePath = path.join(__dirname, oggFileName);

                fs.writeFileSync(oggFilePath, mp3File.Body);

                console.log(`Converted ${fileName} to ${oggFileName}`);

                // Upload the OGG file to the output folder
                const oggFile = fs.readFileSync(oggFilePath);
                await s3
                    .putObject({
                        Bucket: bucketName,
                        Key: `${outputFolder}${oggFileName}`,
                        Body: oggFile,
                        ContentType: 'audio/ogg',
                    })
                    .promise();

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
