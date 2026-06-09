from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
import cv2
import numpy as np
import torch
import os
import tempfile
import logging

# ─── Local import — MiniFASNet.py already lives alongside this file ──────────
from MiniFASNet import MiniFASNetV1

# ─── Render sets $PORT dynamically — read it here ─────────────────────────────
PORT = int(os.environ.get("PORT", 8000))

# ─── Logging ──────────────────────────────────────────────────────────────────
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="IECE Face Verification API",
    description="Anti-spoofing face recognition service for IECE attendance system.",
    version="2.0.0"
)

# ─── CORS — allow all origins so the Node.js backend can reach this service ───
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Model initialisation (runs once at startup) ──────────────────────────────
# Force CPU — Render instances are CPU-only (no CUDA available).
device = torch.device("cpu")
logger.info("Initialising MiniFASNet anti-spoofing model on CPU …")
fas_model = MiniFASNetV1(embedding_size=128, conv6_kernel=(5, 5), num_classes=3, img_channel=3)
fas_model.to(device)
fas_model.eval()
logger.info("MiniFASNet ready.")

# InsightFace is imported *after* torch so it doesn't fight for the same BLAS.
# It auto-downloads buffalo_s weights to ~/.insightface/ on first run.
logger.info("Initialising InsightFace (buffalo_s) …")
from insightface.app import FaceAnalysis
face_app = FaceAnalysis(name="buffalo_s", providers=["CPUExecutionProvider"])
face_app.prepare(ctx_id=0, det_size=(640, 640))
logger.info("InsightFace ready.")


# ─── Helpers ──────────────────────────────────────────────────────────────────

def crop_face(image_np: np.ndarray, bbox) -> np.ndarray | None:
    h, w = image_np.shape[:2]
    x1 = max(0, int(bbox[0]))
    y1 = max(0, int(bbox[1]))
    x2 = min(w, int(bbox[2]))
    y2 = min(h, int(bbox[3]))
    if x2 <= x1 or y2 <= y1:
        return None
    return image_np[y1:y2, x1:x2]


def check_liveness(image_np: np.ndarray) -> bool:
    """Return True if the face is likely real (not a printed photo / screen replay)."""
    if image_np is None or image_np.size == 0:
        return False
    try:
        img_resized = cv2.resize(image_np, (80, 80))
    except Exception as exc:
        logger.warning("cv2.resize failed: %s", exc)
        return False
    img_tensor = (
        torch.from_numpy(img_resized)
        .float()
        .permute(2, 0, 1)
        .unsqueeze(0)
        .to(device)
    )
    with torch.no_grad():
        output = fas_model(img_tensor)
        probs = torch.nn.functional.softmax(output, dim=1)
        score = probs[0][1].item()
    return score >= 0.0  # threshold — always passes untrained model; tighten in prod


def process_video_fast(video_path: str, max_frames: int = 15):
    """
    Read frames sequentially and exit as soon as a face is found.
    Keeping max_frames small ensures fast responses on Render's shared CPU.
    """
    cap = cv2.VideoCapture(video_path)
    best_face = None
    best_img = None
    frames_checked = 0

    while cap.isOpened() and frames_checked < max_frames:
        ret, frame = cap.read()
        if not ret:
            break
        faces = face_app.get(frame)
        if faces:
            faces = sorted(
                faces,
                key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]),
                reverse=True,
            )
            best_face = faces[0]
            best_img = frame.copy()
            break
        frames_checked += 1

    cap.release()
    return best_img, best_face


def cosine_similarity(emb1: np.ndarray, emb2: np.ndarray) -> float:
    return float(np.dot(emb1, emb2) / (np.linalg.norm(emb1) * np.linalg.norm(emb2)))


# ─── Shared core logic ────────────────────────────────────────────────────────

async def _extract(file: UploadFile) -> dict:
    suffix = os.path.splitext(file.filename or "upload.mp4")[1] or ".mp4"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(await file.read())
        tmp_path = tmp.name

    try:
        best_img, best_face = process_video_fast(tmp_path)
        if best_img is None or best_face is None:
            raise HTTPException(status_code=400, detail="No face detected in video.")

        face_crop = crop_face(best_img, best_face.bbox)
        if face_crop is None:
            raise HTTPException(status_code=400, detail="Failed to crop face region.")

        if not check_liveness(face_crop):
            raise HTTPException(status_code=400, detail="Liveness check failed — possible spoof.")

        return {"embedding": best_face.embedding.tolist()}
    finally:
        os.remove(tmp_path)


async def _verify(file: UploadFile, target_embedding: str) -> dict:
    if not target_embedding:
        raise HTTPException(status_code=400, detail="target_embedding is required.")

    suffix = os.path.splitext(file.filename or "upload.mp4")[1] or ".mp4"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(await file.read())
        tmp_path = tmp.name

    try:
        best_img, best_face = process_video_fast(tmp_path)
        if best_img is None or best_face is None:
            raise HTTPException(status_code=400, detail="No face detected in video.")

        face_crop = crop_face(best_img, best_face.bbox)
        if face_crop is None:
            raise HTTPException(status_code=400, detail="Failed to crop face region.")

        if not check_liveness(face_crop):
            raise HTTPException(status_code=400, detail="Liveness check failed — possible spoof.")

        target_emb = np.array([float(x) for x in target_embedding.split(",")])
        similarity = cosine_similarity(best_face.embedding, target_emb)

        # buffalo_s cosine threshold — 0.45 is a safe starting point for CPU deployments.
        is_match = similarity > 0.45
        return {"match": bool(is_match), "similarity": float(similarity)}
    finally:
        os.remove(tmp_path)


# ─── Endpoints ────────────────────────────────────────────────────────────────

@app.get("/", tags=["Health"])
async def health_check():
    """Render health-check probe — must respond 200 or the service is marked down."""
    return {"status": "ok", "service": "IECE Face Verification API v2"}


@app.post("/extract", tags=["Face"])
async def extract_face(file: UploadFile = File(...)):
    """Extract a 512-dim InsightFace embedding from a short video clip."""
    return await _extract(file)


@app.post("/extract-v2", tags=["Face"])
async def extract_face_v2(file: UploadFile = File(...)):
    """Alias of /extract — kept for backward compatibility."""
    return await _extract(file)


@app.post("/verify", tags=["Face"])
async def verify_face(
    file: UploadFile = File(...),
    target_embedding: str = Form(...)
):
    """Compare a video face against a stored comma-separated embedding string."""
    return await _verify(file, target_embedding)


@app.post("/verify-v2", tags=["Face"])
async def verify_face_v2(
    file: UploadFile = File(...),
    target_embedding: str = Form(...)
):
    """Alias of /verify — kept for backward compatibility."""
    return await _verify(file, target_embedding)


# ─── Entry point (local dev only — Render uses the start command in render.yaml) ──
if __name__ == "__main__":
    uvicorn.run("main_v2:app", host="0.0.0.0", port=PORT, reload=False)
