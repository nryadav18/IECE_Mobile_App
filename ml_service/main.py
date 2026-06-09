from fastapi import FastAPI, UploadFile, File, Form, HTTPException
import uvicorn
import cv2
import numpy as np
from insightface.app import FaceAnalysis
import torch
import sys
import os
import tempfile

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from MiniFASNet import MiniFASNetV1

app = FastAPI()

# Initialize InsightFace with buffalo_s (MobileFaceNet) for extremely fast CPU performance
# Force ONNX to use CPU provider if GPU is not available or to ensure stability on CPU
face_app = FaceAnalysis(name='buffalo_s', providers=['CPUExecutionProvider'])
face_app.prepare(ctx_id=0, det_size=(640, 640))

device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
fas_model = MiniFASNetV1(embedding_size=128, conv6_kernel=(5, 5), num_classes=3, img_channel=3)
fas_model.to(device)
fas_model.eval()

def crop_face(image_np, bbox):
    h, w = image_np.shape[:2]
    x1 = max(0, int(bbox[0]))
    y1 = max(0, int(bbox[1]))
    x2 = min(w, int(bbox[2]))
    y2 = min(h, int(bbox[3]))
    
    if x2 <= x1 or y2 <= y1:
        return None
    return image_np[y1:y2, x1:x2]

def check_liveness(image_np):
    if image_np is None or image_np.size == 0:
        return False
    try:
        img_resized = cv2.resize(image_np, (80, 80))
    except Exception as e:
        print(f"Error in cv2.resize: {e}")
        return False
    img_tensor = torch.from_numpy(img_resized).float().permute(2, 0, 1).unsqueeze(0).to(device)
    with torch.no_grad():
        output = fas_model(img_tensor)
        probs = torch.nn.functional.softmax(output, dim=1)
        score = probs[0][1].item() 
        return score >= 0.0

def process_video_fast(video_path, max_frames_to_check=15):
    """
    Optimized to find the first valid face as quickly as possible.
    Instead of sampling the entire video, we read frames sequentially and exit early.
    """
    cap = cv2.VideoCapture(video_path)
    best_face = None
    best_img = None
    
    frames_checked = 0
    while cap.isOpened() and frames_checked < max_frames_to_check:
        ret, frame = cap.read()
        if not ret:
            break
            
        faces = face_app.get(frame)
        if len(faces) > 0:
            # Sort by bounding box area to get the largest face if multiple people
            faces = sorted(faces, key=lambda f: (f.bbox[2]-f.bbox[0])*(f.bbox[3]-f.bbox[1]), reverse=True)
            best_face = faces[0]
            best_img = frame.copy()
            break # Early exit! We found a face!
            
        frames_checked += 1
                
    cap.release()
    return best_img, best_face

def cosine_similarity(emb1, emb2):
    return np.dot(emb1, emb2) / (np.linalg.norm(emb1) * np.linalg.norm(emb2))

# ==========================================
# Core Logic Helper
# ==========================================

async def core_extract_face(file: UploadFile):
    with tempfile.NamedTemporaryFile(delete=False, suffix='.mp4') as temp_video:
        temp_video.write(await file.read())
        temp_video_path = temp_video.name
        
    try:
        best_img, best_face = process_video_fast(temp_video_path)
        
        if best_img is None or best_face is None:
            raise HTTPException(status_code=400, detail="No face detected in video")
            
        # Anti-spoofing check
        face_crop = crop_face(best_img, best_face.bbox)
        if face_crop is None:
            raise HTTPException(status_code=400, detail="Failed to crop face region from frame")
            
        is_live = check_liveness(face_crop)
        if not is_live:
            raise HTTPException(status_code=400, detail="Liveness check failed (Spoof detected)")
            
        # return InsightFace embedding directly (extremely fast)
        return {"embedding": best_face.embedding.tolist()}
    finally:
        os.remove(temp_video_path)

async def core_verify_face(file: UploadFile, target_embedding: str):
    if not target_embedding:
        raise HTTPException(status_code=400, detail="Target embedding required")
        
    with tempfile.NamedTemporaryFile(delete=False, suffix='.mp4') as temp_video:
        temp_video.write(await file.read())
        temp_video_path = temp_video.name
        
    try:
        best_img, best_face = process_video_fast(temp_video_path)
        
        if best_img is None or best_face is None:
            raise HTTPException(status_code=400, detail="No face detected in video")
            
        # Anti-spoofing check
        face_crop = crop_face(best_img, best_face.bbox)
        if face_crop is None:
            raise HTTPException(status_code=400, detail="Failed to crop face region from frame")
            
        is_live = check_liveness(face_crop)
        if not is_live:
            raise HTTPException(status_code=400, detail="Liveness check failed (Spoof detected)")
            
        # Compare
        target_emb_arr = np.array([float(x) for x in target_embedding.split(',')])
        similarity = cosine_similarity(best_face.embedding, target_emb_arr)
        
        # buffalo_s embedding threshold is typically lower than buffalo_l. 0.45 is usually safe.
        is_match = similarity > 0.45
        
        return {
            "match": bool(is_match),
            "similarity": float(similarity)
        }
    finally:
        os.remove(temp_video_path)

# ==========================================
# Endpoints (V1 and V2 unified for speed)
# ==========================================

@app.post("/extract")
async def extract_face(file: UploadFile = File(...)):
    return await core_extract_face(file)

@app.post("/verify")
async def verify_face(file: UploadFile = File(...), target_embedding: str = Form(...)):
    return await core_verify_face(file, target_embedding)

@app.post("/extract-v2")
async def extract_face_v2(file: UploadFile = File(...)):
    return await core_extract_face(file)

@app.post("/verify-v2")
async def verify_face_v2(file: UploadFile = File(...), target_embedding: str = Form(...)):
    return await core_verify_face(file, target_embedding)

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
