import io
import os
import re
import sys
import base64
import logging
from concurrent.futures import ThreadPoolExecutor
from flask import Flask, request, jsonify
from flask_cors import CORS
from PIL import Image
import numpy as np

# Import helper
from ocr_helper import ocr_engine, cluster_manga_boxes, translate_text

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("MangaTranslateServer")

app = Flask(__name__)
# Enable CORS for Chrome extensions and localhost
CORS(app, resources={r"/*": {"origins": "*"}})

@app.route("/", methods=["GET"])
def index():
    return jsonify({
        "name": "Manga Translator Local Fallback Server",
        "status": "online",
        "description": "Serveur local de secours pour la traduction automatique de manga (OCR + Traduction)",
        "endpoints": {
            "GET /health": "Vérifie l'état du serveur",
            "POST /translate": "Traite et traduit une image de scan manga"
        }
    })

@app.route("/health", methods=["GET"])
def health():
    return jsonify({
        "status": "ok",
        "engine": "RapidOCR + GoogleTranslator",
        "version": "1.0.0"
    })

@app.route("/translate", methods=["POST"])
def translate():
    try:
        data = request.get_json(force=True)
        if not data or "image" not in data:
            return jsonify({"success": False, "error": "Aucune image fournie"}), 400

        image_data = data["image"]
        source_lang = data.get("source_lang", "auto")
        target_lang = data.get("target_lang", "fr")

        # Supprimer l'éventuel en-tête base64 data URI (ex: data:image/png;base64,...)
        if "," in image_data:
            image_data = image_data.split(",", 1)[1]

        # Décodage de l'image
        raw_bytes = base64.b64decode(image_data)
        img = Image.open(io.BytesIO(raw_bytes)).convert("RGB")
        img_w, img_h = img.size
        logger.info(f"Image reçue: {img_w}x{img_h}px, langue source: {source_lang} -> cible: {target_lang}")

        # Conversion numpy pour RapidOCR
        img_np = np.array(img)

        # Exécution de l'OCR
        ocr_result, elapse_list = ocr_engine(img_np)
        if not ocr_result:
            logger.info("Aucun texte détecté dans l'image.")
            return jsonify({
                "success": True,
                "engine": "local_rapidocr",
                "count": 0,
                "bubbles": []
            })

        logger.info(f"Lignes détectées par OCR: {len(ocr_result)}")

        # Regroupement des lignes proches en bulles de manga cohérentes
        clusters = cluster_manga_boxes(ocr_result, img_w, img_h)
        logger.info(f"Bulles regroupées: {len(clusters)}")

        # Traduction concurrente de chaque bulle pour une vitesse maximale
        def process_bubble(bubble):
            text = bubble["original_text"]
            # Filtrer les bruits d'OCR très courts ou sans lettres/kanji
            if not text or len(text.strip()) == 0:
                return None
            trans = translate_text(text, source_lang=source_lang, target_lang=target_lang)
            return {
                "box_2d": bubble["box_2d"],
                "original_text": text,
                "translation": trans,
                "confidence": bubble.get("confidence", 0.9)
            }

        with ThreadPoolExecutor(max_workers=5) as executor:
            processed = list(executor.map(process_bubble, clusters))

        valid_bubbles = [b for b in processed if b is not None]

        return jsonify({
            "success": True,
            "engine": "local_rapidocr",
            "count": len(valid_bubbles),
            "bubbles": valid_bubbles
        })

    except Exception as e:
        logger.error(f"Erreur lors du traitement: {e}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    print(f"==================================================")
    print(f"  MANGA TRANSLATOR - SERVEUR LOCAL DE SECOURS")
    print(f"  Écoute sur http://127.0.0.1:{port}")
    print(f"  Prêt à recevoir les requêtes de l'extension")
    print(f"==================================================")
    app.run(host="127.0.0.1", port=port, debug=False, threaded=True)
