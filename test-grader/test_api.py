import base64, time, os
from openai import OpenAI
from PIL import Image

img_path = r"X:\AI\projects\XDF-obsidian-system\obsidian-plugin\obsidian-plugin-XDF-tookits\test-grader\raw\3413中级讲义\叶洋孜.jpg"
img = Image.open(img_path)
img = img.resize((img.width // 2, img.height // 2), Image.LANCZOS)
os.makedirs(r"X:\AI\projects\XDF-obsidian-system\obsidian-plugin\obsidian-plugin-XDF-tookits\test-grader\cache", exist_ok=True)
compressed = r"X:\AI\projects\XDF-obsidian-system\obsidian-plugin\obsidian-plugin-XDF-tookits\test-grader\cache\test_small.jpg"
img.save(compressed, quality=80)
print(f"压缩后: {os.path.getsize(compressed)/1024/1024:.1f} MB")

with open(compressed, "rb") as f:
    b64 = base64.b64encode(f.read()).decode()
print(f"base64: {len(b64)/1024/1024:.1f} MB")

client = OpenAI(base_url="https://coding.dashscope.aliyuncs.com/v1", api_key="sk-sp-dac515a1df174fd1bb64394aa2c5c31b")
print("开始调用多模态 API...")
t0 = time.time()
r = client.chat.completions.create(
    model="qwen3.7-plus",
    messages=[{"role": "user", "content": [
        {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}},
        {"type": "text", "text": "这是几张图片？只回答数字"}
    ]}],
    max_tokens=10,
)
print(f"耗时: {time.time()-t0:.1f}s")
print(r.choices[0].message.content)
