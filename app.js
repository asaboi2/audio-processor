const AWS = require("@aws-sdk/client-s3");
const fs = require("fs");
const path = require("path");
const ffmpeg = require("fluent-ffmpeg");
const axios = require("axios");

// Initialize S3 client
const s3 = new AWS.S3({
  endpoint: "https://nyc3.digitaloceanspaces.com",
  region: "us-east-1",
  credentials: {
    accessKeyId: process.env.SPACES_KEY,
    secretAccessKey: process.env.SPACES_SECRET,
  },
});

const bucketName = "audio-uploads-questworks";

// Function to download file from S3
async function downloadFileFromS3(key) {
  const params = { Bucket: bucketName, Key: key };
  const data = await s3.getObject(params);
  return Buffer.from(await data.Body.transformToByteArray());
}

// Function to convert MP3 to OGG
async function convertMp3ToOgg(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .audioCodec("libvorbis")
      .audioQuality(0.1) // Set quality to 0.1 for smaller file size
      .on("end", () => resolve())
      .on("error", (err) => reject(err))
      .save(outputPath);
  });
}

// Function to upload file to S3
async function uploadFileToS3(key, filePath) {
  const fileContent = fs.readFileSync(filePath);
  const params = {
    Bucket: bucketName,
    Key: key,
    Body: fileContent,
    ContentType: "audio/ogg",
  };
  await s3.putObject(params);
}

// Function to check for new files and process them
async function checkForNewFiles() {
  try {
    console.log("[audio-processor] Checking for new MP3 files...");
    const listParams = { Bucket: bucketName, Prefix: "mp3/" };
    const listResponse = await s3.listObjectsV2(listParams);

    if (!listResponse.Contents || listResponse.Contents.length === 0) {
      console.log("[audio-processor] No new MP3 files found.");
      return;
    }

    for (const file of listResponse.Contents) {
      const key = file.Key;
      if (!key.endsWith(".mp3")) continue;

      console.log(`[audio-processor] Processing file: ${key}`);
      const fileName = path.basename(key);
      const inputPath = `/tmp/${fileName}`;
      const outputFileName = fileName.replace(".mp3", ".ogg");
      const outputPath = `/tmp/${outputFileName}`;

      // Download the file
      const fileBuffer = await downloadFileFromS3(key);
      fs.writeFileSync(inputPath, fileBuffer);
      console.log(`[audio-processor] Downloaded file: ${fileName}`);

      // Convert to OGG
      await convertMp3ToOgg(inputPath, outputPath);
      console.log(`[audio-processor] Converted ${fileName} to ${outputFileName}`);

      // Upload the OGG file to S3
      await uploadFileToS3(`ogg/${outputFileName}`, outputPath);
      console.log(`[audio-processor] Uploaded ${outputFileName} to ogg/`);

      // Send a webhook to Zapier
      await axios.post("https://hooks.zapier.com/hooks/catch/20789352/282fw24/", {
        filename: outputFileName,
        url: `https://audio-uploads-questworks.nyc3.digitaloceanspaces.com/ogg/${outputFileName}`,
      });

      console.log("[audio-processor] Webhook sent to Zapier.");
    }
  } catch (err) {
    console.error("[audio-processor] Error processing files:", err);
  }
}

// Run the check every 20 seconds
setInterval(checkForNewFiles, 20000);
