import os
import subprocess
import time
import boto3

print("Script started")

WATCH_FOLDER = "/Volumes/New Volume"
PROCESSED_FOLDER = "/Volumes/New Volume/mp4_done"

S3_BUCKET = "fff-store"
S3_FOLDER = "video/"

s3 = boto3.client("s3")  

def upload_to_s3(file_path, bucket, key):
    try:
        s3.upload_file(file_path, bucket, key)
        print(f"✓ Uploaded to S3: s3://{bucket}/{key}")
        return True
    except Exception as e:
        print(f"✗ Upload failed: {e}")
        return False

while True:
    try:
        if not os.path.exists(WATCH_FOLDER):
            print(f"Watch folder '{WATCH_FOLDER}' not found. Waiting...")
            time.sleep(5)
            continue

        os.makedirs(PROCESSED_FOLDER, exist_ok=True)

        print("Scanning folder...")
        for file in os.listdir(WATCH_FOLDER):
            if file.startswith("."):
                continue

            if file.endswith(".mjpeg"):
                print("Processing MJPEG file:", file)
                mjpeg_path = os.path.join(WATCH_FOLDER, file)
                mp4_name = file.replace(".mjpeg", ".mp4")
                mp4_path = os.path.join(PROCESSED_FOLDER, mp4_name)

                if not os.path.exists(mp4_path):
                    print(f"Converting {file} to MP4...")
                    result = subprocess.run([
                        "ffmpeg",
                        "-y",
                        "-i", mjpeg_path,
                        "-c:v", "libx264",
                        "-pix_fmt", "yuv420p",
                        mp4_path
                    ], capture_output=True, text=True)
                    
                    if result.returncode != 0:
                        print("FFmpeg failed:")
                        print(result.stderr)
                        continue
                    
                    print(f"✓ Conversion done: {mp4_path}")

                    s3_key = f"{S3_FOLDER}{mp4_name}"
                    print(f"Uploading {mp4_path} as {s3_key}")
                    if os.path.exists(mp4_path) and upload_to_s3(mp4_path, S3_BUCKET, s3_key):
                        try:
                            os.remove(mp4_path)
                            os.remove(mjpeg_path)
                            print(f"✓ Deleted local files: {mp4_path}, {mjpeg_path}")
                        except Exception as e:
                            print(f"Failed to delete files: {e}")

        time.sleep(5)

    except Exception as e:
        print(f"Error in main loop: {e}")
        time.sleep(5)
