# Jarvis Projection Touch (MVP)

Aplicação estilo "Jarvis" para projeção com múltiplas telas, recebendo toques por câmera (visão computacional). Este MVP inclui:

- Backend em FastAPI que serve a UI e oferece um WebSocket para eventos de toque.
- Frontend web com múltiplas telas e botões, navegáveis por clique e por "toques" recebidos via WebSocket.
- Detector de toques com OpenCV (esqueleto). No modo teste, gera toques sintéticos a cada 3 segundos.
 - Detector de objetos com YOLO (Ultralytics), com caixas desenhadas na UI.

## Requisitos

- Python 3.10+ recomendado
- Windows 10/11 (funciona também em Linux/macOS)

## Instalação

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

## Execução

```bash
python run.py
```

Abra o navegador no projetor em: `http://localhost:8000/`

No primeiro uso, o detector está no "modo teste" (gera toques automáticos). Você verá um marcador de toque e os botões serão "clicados".

### Detecção de objetos
- O backend inicia um detector YOLO (modelo `yolov8n.pt`) automaticamente. No primeiro run, o modelo será baixado.
- As detecções são enviadas via WebSocket e desenhadas como caixas na UI (com rótulo e confiança).
- Requisitos: CPU funciona, mas desempenho melhora com GPU. Em Windows, a instalação de `ultralytics` pode instalar `torch` CPU (mais lento).

## Estrutura

- `backend/main.py`: servidor FastAPI, WebSocket, fila de eventos e integração com detector.
- `backend/touch_detector.py`: esqueleto do detector com OpenCV e modo teste.
- `backend/object_detector.py`: detector de objetos com YOLO (Ultralytics).
- `frontend/`: UI web (HTML, CSS, JS).
- `run.py`: inicializador do servidor.

## Próximos passos (planejados)

1. Calibração da área projetada (homografia 4 pontos) e salvamento em arquivo.
2. Detecção de dedo/toque por visão computacional (contato com plano, filtragem de ruído).
3. Mapeamento preciso do toque para coordenadas da UI (x,y normalizados).
4. UI de calibração acessível via navegador.

## Observações

- Em ambiente de produção, execute sem `reload` e com um único worker para simplificar a integração com threads do OpenCV.
- Para projetores configurados como "tela estendida", ajuste o navegador para a resolução do projetor. O detector deve ser calibrado para esse retângulo visível.


