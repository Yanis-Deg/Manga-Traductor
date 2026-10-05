import io
import re
import math
import base64
import json
import urllib.request
import urllib.parse
from PIL import Image
import numpy as np
from rapidocr_onnxruntime import RapidOCR

ocr_engine = RapidOCR()

def translate_text(text: str, source_lang: str = "auto", target_lang: str = "fr") -> str:
    """Traduit un texte via le service de traduction en ligne gratuit Google GTX."""
    if not text or not text.strip():
        return ""
    try:
        url = (
            f"https://translate.googleapis.com/translate_a/single?"
            f"client=gtx&sl={source_lang}&tl={target_lang}&dt=t&q="
            + urllib.parse.quote(text)
        )
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
        with urllib.request.urlopen(req, timeout=5) as response:
            data = json.loads(response.read().decode("utf-8"))
            translated_parts = [item[0] for item in data[0] if item and item[0]]
            return "".join(translated_parts)
    except Exception as e:
        print(f"Translation error for '{text[:20]}...': {e}")
        return text

def cluster_manga_boxes(ocr_results, img_width, img_height, max_dist_ratio=0.03):
    """
    Regroupe intelligemment les lignes de texte proches pour reformer une même bulle de manga.
    Chaque résultat OCR = [points, text, confidence]
    points = [[x1, y1], [x2, y2], [x3, y3], [x4, y4]]
    """
    if not ocr_results:
        return []

    boxes = []
    for item in ocr_results:
        pts, text, conf = item
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        min_x, max_x = min(xs), max(xs)
        min_y, max_y = min(ys), max(ys)
        w = max_x - min_x
        h = max_y - min_y
        center_x = (min_x + max_x) / 2
        center_y = (min_y + max_y) / 2
        boxes.append({
            "min_x": min_x, "min_y": min_y,
            "max_x": max_x, "max_y": max_y,
            "w": w, "h": h,
            "center_x": center_x, "center_y": center_y,
            "text": text.strip(),
            "conf": conf
        })

    # Regroupement par proximité (algorithme de composantes connexes)
    # Seuil de distance pour regrouper deux morceaux de texte dans la même bulle
    threshold_dist = max(img_width, img_height) * max_dist_ratio

    clusters = []
    visited = set()

    for i in range(len(boxes)):
        if i in visited:
            continue
        cluster = [boxes[i]]
        visited.add(i)
        queue = [boxes[i]]

        while queue:
            curr = queue.pop(0)
            for j in range(len(boxes)):
                if j in visited:
                    continue
                target = boxes[j]

                # Calcul de la distance entre boîtes
                dx = max(0, max(curr["min_x"], target["min_x"]) - min(curr["max_x"], target["max_x"]))
                dy = max(0, max(curr["min_y"], target["min_y"]) - min(curr["max_y"], target["max_y"]))
                dist = math.hypot(dx, dy)

                # Si très proches ou superposées, on les associe à la même bulle
                if dist < threshold_dist or (dx < 15 and dy < 25) or (dy < 15 and dx < 25):
                    visited.add(j)
                    cluster.append(target)
                    queue.append(target)
        clusters.append(cluster)

    # Fusion des clusters en bulles uniques
    merged_bubbles = []
    for cluster in clusters:
        min_x = min(b["min_x"] for b in cluster)
        min_y = min(b["min_y"] for b in cluster)
        max_x = max(b["max_x"] for b in cluster)
        max_y = max(b["max_y"] for b in cluster)

        # Déterminer si le texte est plutôt vertical (manga japonais) ou horizontal (anglais/français)
        avg_w = sum(b["w"] for b in cluster) / len(cluster)
        avg_h = sum(b["h"] for b in cluster) / len(cluster)
        is_vertical = avg_h > avg_w * 1.5

        if is_vertical:
            # Japonais traditionnel : lu de droite à gauche, puis de haut en bas
            sorted_cluster = sorted(cluster, key=lambda b: (-b["center_x"], b["center_y"]))
        else:
            # Horizontal (anglais/occidental) : de haut en bas, puis de gauche à droite
            sorted_cluster = sorted(cluster, key=lambda b: (b["min_y"], b["min_x"]))

        # Concaténer le texte
        joined_text = " ".join(b["text"] for b in sorted_cluster if b["text"])
        avg_conf = sum(b["conf"] for b in cluster) / len(cluster)

        # Normaliser les coordonnées en échelle 0-1000 pour être compatible avec Gemini
        ymin = max(0, min(1000, int((min_y / img_height) * 1000)))
        xmin = max(0, min(1000, int((min_x / img_width) * 1000)))
        ymax = max(0, min(1000, int((max_y / img_height) * 1000)))
        xmax = max(0, min(1000, int((max_x / img_width) * 1000)))

        # Ajouter une petite marge (padding) autour du texte pour recouvrir la bulle proprement
        padding_y = int((ymax - ymin) * 0.1)
        padding_x = int((xmax - xmin) * 0.1)
        ymin = max(0, ymin - padding_y)
        xmin = max(0, xmin - padding_x)
        ymax = min(1000, ymax + padding_y)
        xmax = min(1000, xmax + padding_x)

        merged_bubbles.append({
            "box_2d": [ymin, xmin, ymax, xmax],
            "original_text": joined_text,
            "confidence": round(avg_conf, 3)
        })

    return merged_bubbles
