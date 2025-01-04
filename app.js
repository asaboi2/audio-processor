// app.js
const AWS = require('aws-sdk');
const fs = require('fs');
const { execSync } = require('child_process');
const express = require('express');

const app = express();
const port = process.env.PORT || 3000;

// Configure AWS
const s3 = new AWS.S3({
  endpoint: 'https://nyc3.digitaloceanspaces.com',
  accessKeyId: process.env.SPACES_KEY,
  secretAccessKey: process.env.SPACES_SECRET,
  s3ForcePathStyle: true,
  region: 'us-east-1'
});

// Every 5 minutes, check for new MP3s
setInterval(async () => {
  try {
    console.log('Checking for new MP3s...');
    
    const objects = await s3.listObjects({
      Bucket: 'audio-uploads-questworks'
    }).promise();

    // Find MP3s that don't have OGG versions
    const mp3Files = objects.Contents.filter(obj => 
      obj.Key.toLowerCase().endsWith('.mp3') && 
      !objects.Contents.some(oggObj => 
        oggObj.Key === `ogg/${obj.Key.replace('.mp3', '.ogg')}`
      )
    );

    for (const file of mp3Files) {
      const fileName = file.Key;
      console.log(`Converting ${fileName}`);
      
      // Download MP3
      const s3File = await s3.getObject({
        Bucket: 'audio-uploads-questworks',
        Key: fileName
      }).promise();

      // Save MP3 to temp file
      fs.writeFileSync(`/tmp/${fileName}`, s3File.Body);

      // Convert to OGG
      execSync(`ffmpeg -i "/tmp/${fileName}" -c:a libvorbis -q:a 2 -ac 1 -ar 22050 "/tmp/${fileName}.ogg"`);

      // Upload OGG
      await s3.putObject({
        Bucket: 'audio-uploads-questworks',
        Key: `ogg/${fileName.replace('.mp3', '.ogg')}`,
        Body: fs.readFileSync(`/tmp/${fileName}.ogg`),
        ContentType: 'audio/ogg',
        ACL: 'public-read'
      }).promise();

      // Cleanup
      fs.unlinkSync(`/tmp/${fileName}`);
      fs.unlinkSync(`/tmp/${fileName}.ogg`);
      
      console.log(`Converted ${fileName} to OGG`);
    }
  } catch (error) {
    console.error('Error:', error);
  }
}, 5 * 60 * 1000);  // Run every 5 minutes

// Simple health check endpoint
app.get('/', (req, res) => {
  res.send('MP3 converter running');
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
