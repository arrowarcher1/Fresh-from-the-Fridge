import sensor
import time
import pyb
import os


sensor.reset()
sensor.set_pixformat(sensor.RGB565)
sensor.set_framesize(sensor.VGA)
sensor.skip_frames(time=2000)

switch_pin = pyb.Pin("P0", pyb.Pin.IN, pyb.Pin.PULL_UP)

print("=== Video Recording ===")
print("Switch released (1) = RECORD")
print("Switch pressed (0) = STOP & SAVE")

clock = time.clock()
recording = False
frame_count = 0
recording_number = 0

pyb.mount(pyb.SDCard(), "/sd")

try:
    if "sd" in os.listdir("/"):
        stat = os.statvfs("/sd")
        free_mb = (stat[0] * stat[3]) / (1024 * 1024)
        print(f"✓ SD Card: {free_mb:.1f} MB free")
    else:
        print("✗ No SD card detected or not mounted!")
except Exception as e:
    print("✗ SD card error:", e)

print("\nRelease switch to start recording...")

def convert_to_video_and_mount_new(rec_num, num_frames, new_volume="/Volumes/New Volume"):
    """Convert saved JPEGs to MJPEG video, cleanup, then mount a new volume"""
    print("\n>>> Creating video file... <<<")
    success = False
    try:
        output_filename = f"/sd/video_{rec_num}.mjpeg"
        with open(output_filename, "wb") as video_file:
            for i in range(num_frames):
                filename = f"/sd/vid{rec_num}_{i:05d}.jpg"
                try:
                    with open(filename, "rb") as img_file:
                        while True:
                            chunk = img_file.read(1024) 
                            if not chunk:
                                break
                            video_file.write(chunk)
                    if i % 20 == 0:
                        print(f"  Frame {i}/{num_frames}...")
                except Exception as e:
                    print(f"Error on frame {i}: {e}")
                    continue

        video_size = os.stat(output_filename)[6]
        print(f"✓ Video created: {output_filename}")
        print(f"✓ Size: {video_size / (1024*1024):.2f} MB")
        success = True

    except Exception as e:
        print(f"Conversion error: {e}")

    try:
        deleted = 0
        for i in range(num_frames):
            filename = f"/sd/vid{rec_num}_{i:05d}.jpg"
            try:
                os.remove(filename)
                deleted += 1
            except:
                pass
        print(f"✓ Deleted {deleted} temporary image files")
    except Exception as e:
        print(f"Cleanup error: {e}")

    try:
        new_sd = pyb.SDCard()
        pyb.mount(new_sd, new_volume)
        print(f"✓ Mounted new volume: {new_volume}")
    except Exception as e:
        print(f"⚠️ Failed to mount {new_volume}: {e}")

    return success

while True:
    clock.tick()
    switch_state = switch_pin.value()

    if switch_state == 1 and not recording:
        print(f"\n>>> RECORDING {recording_number} STARTED <<<")
        frame_count = 0
        recording = True

    elif switch_state == 0 and recording:
        print(f"\n>>> STOPPED - {frame_count} frames <<<")
        recording = False

        if frame_count > 0:
            convert_to_video_and_mount_new(recording_number, frame_count, "/Volumes/New Volume")

        recording_number += 1
        print(f"\n✓ Ready for recording {recording_number}")

    img = sensor.snapshot()
    if recording:
        try:
            filename = f"/sd/vid{recording_number}_{frame_count:05d}.jpg"
            img.save(filename, quality=90)
            frame_count += 1

            if frame_count % 30 == 0:
                print(f"Recording: {frame_count} frames @ {clock.fps():.1f} FPS")

        except Exception as e:
            print(f"ERROR: {e}")
            recording = False
