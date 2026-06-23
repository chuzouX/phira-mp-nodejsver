import hashlib
import os
from datetime import datetime
try:
    from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
    from cryptography.hazmat.primitives import padding
    from cryptography.hazmat.backends import default_backend
except ImportError:
    print("错误: 缺少依赖库 'cryptography'。")
    print("请运行: pip install cryptography")
    exit(1)

def generate_admin_secret(admin_secret_env):
    # 1. 准备原始明文: {YYYY-MM-DD}_{ADMIN_SECRET}_xy521
    date_str = datetime.now().strftime("%Y-%m-%d")
    plain_text = f"{date_str}_{admin_secret_env}_xy521"
    
    # 2. 生成 Key: ADMIN_SECRET 的 SHA256 (32字节)
    key = hashlib.sha256(admin_secret_env.encode('utf-8')).digest()
    
    # 3. 生成 随机 IV (16字节)
    iv = os.urandom(16)
    
    # 4. 对明文进行 PKCS7 填充 (AES 块大小为 128 bit)
    padder = padding.PKCS7(128).padder()
    padded_data = padder.update(plain_text.encode('utf-8')) + padder.finalize()
    
    # 5. AES-256-CBC 加密
    cipher = Cipher(algorithms.AES(key), modes.CBC(iv), backend=default_backend())
    encryptor = cipher.encryptor()
    ciphertext = encryptor.update(padded_data) + encryptor.finalize()
    
    # 6. 拼接 IV + Ciphertext 并转为 Hex 字符串
    result = (iv + ciphertext).hex()
    
    print(f"--- 管理员加密工具 ---")
    print(f"当前日期: {date_str}")
    print(f"原始明文: {plain_text}")
    print(f"生成的加密串 (admin_secret): {result}")
    print(f"----------------------")
    return result

if __name__ == "__main__":
    # 从环境变量读取或在此手动设置
    # 注意：此值必须与服务器 .env 中的 ADMIN_SECRET 完全一致
    import sys
    
    if len(sys.argv) > 1:
        my_secret = sys.argv[1]
    else:
        my_secret = input("请输入服务器的 ADMIN_SECRET: ").strip()
    
    if not my_secret:
        print("错误: 未提供 ADMIN_SECRET")
    else:
        generate_admin_secret(my_secret)
