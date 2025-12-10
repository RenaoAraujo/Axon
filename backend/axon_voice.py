import sounddevice as sd
import numpy as np
import scipy.io.wavfile as wav
from faster_whisper import WhisperModel
from openai import OpenAI
import subprocess
import uuid

# CONFIGURAÇÕES
OPENAI_API_KEY = "SUA_CHAVE_AQUI"
MODEL = "gpt-4.1-mini"  # pode trocar para gpt-4.1, gpt-5 etc.
MODEL_WHISPER = "small"  # small é rápido e bom
VOICE = "tts_models/pt/cv/vits"  # voz em PT do Coqui

client = OpenAI(api_key=OPENAI_API_KEY)

whisper = WhisperModel(MODEL_WHISPER, device="cpu")

# =============== 1. GRAVAR ÁUDIO ===============
def gravar_audio(filename="input.wav", duration=4, fs=44100):
    print("🎤 Axon está ouvindo...")
    audio = sd.rec(int(duration * fs), samplerate=fs, channels=1)
    sd.wait()
    wav.write(filename, fs, audio)

# =============== 2. TRANSCRITAR ÁUDIO ===============
def transcrever(filename="input.wav"):
    segments, info = whisper.transcribe(filename, beam_size=5)
    texto = " ".join([seg.text for seg in segments])
    print(f"📝 Você disse: {texto}")
    return texto.strip()

# =============== 3. ENVIAR PARA OPENAI ===============
def responder(texto):
    completion = client.chat.completions.create(
        model=MODEL,
        messages=[{"role": "user", "content": texto}]
    )
    resposta = completion.choices[0].message.content
    print(f"🤖 Axon: {resposta}")
    return resposta

# =============== 4. FALAR (TTS) ===============
def falar(texto):
    nome_audio = f"resposta_{uuid.uuid4().hex}.wav"
    subprocess.run([
        "tts",
        "--text", texto,
        "--model_name", VOICE,
        "--out_path", nome_audio
    ])
    fs, data = wav.read(nome_audio)
    sd.play(data, fs)
    sd.wait()

# =============== LOOP PRINCIPAL ===============
if __name__ == "__main__":
    print("=== AXON - Voice Agent ===")

    while True:
        gravar_audio()
        texto = transcrever()

        if texto.lower() in ["sair", "encerrar", "parar", "tchau"]:
            print("Encerrando Axon...")
            break

        resposta = responder(texto)
        falar(resposta)
