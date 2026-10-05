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

def generate_admin_secret(admin_secret_env, legacy=False):
    import time
    import secrets
    if legacy:
        date_str = datetime.now().strftime("%Y-%m-%d")
        plain_text = f"{date_str}_{admin_secret_env}_xy521"
    else:
        timestamp = int(time.time())
        nonce = secrets.token_hex(8)
        plain_text = f"{timestamp}_{nonce}_{admin_secret_env}_xy521"
    
    key = hashlib.sha256(admin_secret_env.encode('utf-8')).digest()
    iv = os.urandom(16)
    padder = padding.PKCS7(128).padder()
    padded_data = padder.update(plain_text.encode('utf-8')) + padder.finalize()
    cipher = Cipher(algorithms.AES(key), modes.CBC(iv), backend=default_backend())
    encryptor = cipher.encryptor()
    ciphertext = encryptor.update(padded_data) + encryptor.finalize()
    result = (iv + ciphertext).hex()
    
    print(f"--- 管理员加密工具 ---")
    print(f"模式: {'旧版日期' if legacy else '时间戳+Nonce (推荐)'}")
    print(f"原始明文: {plain_text}")
    print(f"生成的加密串 (admin_secret): {result}")
    print(f"----------------------")
    return result

if __name__ == "__main__":
    # 从环境变量读取或在此手动设置
    # 注意：此值必须与服务器 .env 中的 ADMIN_SECRET 完全一致
    import sys
    
    args = [a for a in sys.argv[1:] if a != '--legacy']
    is_legacy = '--legacy' in sys.argv[1:]
    if args:
        my_secret = args[0]
    else:
        my_secret = input("请输入服务器的 ADMIN_SECRET: ").strip()
    
    if not my_secret:
        print("错误: 未提供 ADMIN_SECRET")
    else:
        generate_admin_secret(my_secret, legacy=is_legacy)
