const { S3Client, ListObjectsV2Command, GetObjectCommand, PutObjectCommand } = require("@aws-sdk/client-s3");
const axios = require("axios");
const fs = require("fs");
const { exec } = require("child_process");

// Configuration
const s3 = new S3Client({
    endpoint: "https://nyc3.digitaloceanspaces.com",
    region: "nyc3",
    credentials: {
        accessKeyId: process.env.SPACES_KEY,
        secretAccessKey: process.env.SPACES_SECRET
    }
});

const bucketName = "your-space-name";
const mp3Folder = "mp3";
const oggFolder = "ogg";
const webhookUrl = "https://hooks.zapier.com/hooks/catch/20789352/282fw24/";

const checkForNewFiles = async () => {
    try {
        console.log("[audio-processor] Checking for new MP3 files...");
        const command = new ListObjectsV2Command({ Bucket: bucketName, Prefix: `${mp3Folder}/` });
        const files = await s3.send(command);

        if (!files.Contents || files.Contents.length === 0) {
            console.log("[audio-processor] No new MP3 files found.");
            return;
        }

        for (const file of files.Contents) {
            const fileName = file.Key.split("/").pop();
            if (!fileName.endsWith(".mp3")) continue;

            console.log(`[audio-processor] Processing file: ${fileName}`);

            const downloadCommand = new GetObjectCommand({
                Bucket: bucketName,
                Key: file.Key
            });
            const fileData = await s3.send(downloadCommand);

            const downloadPath = `temp_input.mp3`;
            const uploadPath = `temp_output.ogg`;

            const stream = fileData.Body;
            const writeStream = fs.createWriteStream(downloadPath);
            stream.pipe(writeStream);
            await new Promise(resolve => writeStream.on("finish", resolve));

            console.log(`[audio-processor] Downloaded file: ${fileName}`);

            // FFmpeg command to convert MP3 to OGG with high compression
            const ffmpegCommand = `ffmpeg -i ${downloadPath} -vn -map_metadata -1 -ac 1 -c:a libvorbis -q:a 0.1 -hide_banner -loglevel error ${uploadPath}`;

            exec(ffmpegCommand, async (error, stdout, stderr) => {
                if (error) {
                    console.error(`[audio-processor] FFmpeg Error: ${error.message}`);
                    return;
                }

                console.log(`[audio-processor] Converted ${fileName} to OGG`);

                // Upload the OGG file to Spaces
                const uploadCommand = new PutObjectCommand({
                    Bucket: bucketName,
                    Key: `${oggFolder}/${fileName.replace(".mp3", ".ogg")}`,
                    Body: fs.readFileSync(uploadPath),
                    ContentType: "audio/ogg"
                });

                await s3.send(uploadCommand);
                console.log(`[audio-processor] Uploaded ${fileName.replace(".mp3", ".ogg")} to ${oggFolder}/`);

                // Send webhook to Zapier
                try {
                    await axios.post(webhookUrl, {
                        filename: fileName.replace(".mp3", ".ogg"),
                        downloadUrl: `https://${bucketName}.nyc3.digitaloceanspaces.com/${oggFolder}/${fileName.replace(".mp3", ".ogg")}`
                    });
                    console.log(`[audio-processor] Webhook sent for: ${fileName.replace(".mp3", ".ogg")}`);
                } catch (err) {
                    console.error(`[audio-processor] Error sending webhook: ${err.message}`);
                }

                // Clean up temporary files
                fs.unlinkSync(downloadPath);
                fs.unlinkSync(uploadPath);
            });
        }
    } catch (err) {
        console.error(`[audio-processor] Error processing files: ${err.message}`);
    }
};

// Run the file check every 20 seconds
setInterval(checkForNewFiles, 20000);
