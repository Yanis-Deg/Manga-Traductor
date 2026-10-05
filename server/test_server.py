import io
import json
import base64
from PIL import Image, ImageDraw, ImageFont
from server import app

def test_local_server():
    client = app.test_client()

    # 1. Test GET /health
    res = client.get("/health")
    assert res.status_code == 200, f"Health check failed: {res.status_code}"
    health_data = json.loads(res.data)
    print("[PASS] GET /health ->", health_data)

    # 2. Create a synthetic test manga image
    width, height = 600, 800
    img = Image.new("RGB", (width, height), color="#F0F0F0")
    draw = ImageDraw.Draw(img)

    # Draw a manga bubble (white ellipse with black border)
    bubble_box = [150, 200, 450, 450]
    draw.ellipse(bubble_box, fill="white", outline="black", width=4)

    # Add text inside the bubble
    try:
        font = ImageFont.truetype("arial.ttf", 26)
    except:
        font = ImageFont.load_default()

    draw.text((200, 300), "I will defeat you!", fill="black", font=font)

    # Convert to base64
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    b64_img = base64.b64encode(buf.getvalue()).decode("utf-8")

    # 3. Test POST /translate
    payload = {
        "image": f"data:image/jpeg;base64,{b64_img}",
        "source_lang": "en",
        "target_lang": "fr"
    }

    res = client.post("/translate", data=json.dumps(payload), content_type="application/json")
    assert res.status_code == 200, f"Translation request failed: {res.status_code}, data: {res.data}"
    res_data = json.loads(res.data)
    print("\n[PASS] POST /translate response:")
    print("Success:", res_data.get("success"))
    print("Engine:", res_data.get("engine"))
    print("Count:", res_data.get("count"))
    for b in res_data.get("bubbles", []):
        print("  - Bubble box (normalized 0-1000):", b["box_2d"])
        print("    Original:", b["original_text"])
        print("    Translation:", b["translation"])

if __name__ == "__main__":
    test_local_server()
