# 📚 Manga Translator - Extension IA & Secours Local

Traducteur automatique de scans de mangas pour navigateur web (**Chrome**, **Edge**, **Brave**, etc.), combinant la puissance de l'IA multimodale de pointe et un serveur local autonome de secours.

---

## 🎯 Fonctionnalités Clés

- **🌐 Intégration Navigateur Directe** : Fonctionne sur n'importe quel site de manga (MangaDex, Scan-VF, Webtoons, etc.).
- **🔄 Stratégie Double-Moteur avec Basculement Automatique** :
  1. **Solution 1 (Prioritaire)** : **Google Gemini Flash IA** (compréhension du contexte, dialogues naturels en français, lecture de droite à gauche).
  2. **Solution 2 (Secours Automatique)** : **Serveur Local Python (RapidOCR + Google Translate)** qui prend le relais instantanément dès que les tokens ou quotas sont épuisés.
- **💬 Remplacement Non Destructif des Bulles** : Masque le texte d'origine avec un fond blanc ajusté et place la traduction française avec une typographie de bande dessinée redimensionnée dynamiquement.
- **🎯 Outil de Sélection de Zone (Snipping)** : Tracez un rectangle à la souris sur une bulle spécifique pour ne traduire que celle-ci.
- **⚡ Raccourcis Clavier Rapides** :
  - `Alt + T` : Traduire la page visible.
  - `Alt + S` : Sélectionner une zone / bulle à traduire.
  - `Alt + H` : Masquer / Afficher les traductions.
- **🔍 Infobulles Interactives** : Survolez une bulle pour voir le texte original et le moteur utilisé. Cliquez dessus pour alterner entre original et français.

---

## 📁 Structure du Projet

```
Traduc/
├── extension/                       # Extension de navigateur (Manifest V3)
│   ├── manifest.json                # Déclaration de l'extension Chromium
│   ├── background.js                # Service Worker (gestion des APIs, CORS, fallback auto)
│   ├── content.js                   # Détection des images, placement des bulles et raccourcis
│   ├── content.css                  # Styles des bulles manga, barre d'outils et animations
│   ├── popup.html                   # Interface de réglages et de test
│   ├── popup.js                     # Logique du popup
│   ├── popup.css                    # Thème sombre manga du popup
│   └── icons/                       # Icônes de l'extension
├── server/                          # Solution 2 : Serveur Local de Secours
│   ├── server.py                    # Serveur Flask avec endpoints /health et /translate
│   ├── ocr_helper.py                # Détection RapidOCR, regroupement de bulles & traduction
│   ├── test_server.py               # Script de validation automatique
│   ├── requirements.txt             # Dépendances Python
│   └── start_server.bat             # Lanceur Windows 1-clic
├── sample_manga_page.jpg            # Page de test synthétique avec bulles
├── test_page.html                   # Page Web de test locale prête à l'emploi
├── guide_installation.md            # Guide pas-à-pas illustré en français
└── README.md                        # Documentation technique
```

---

## 🛠️ Démarrage Rapide

Consultez le fichier [guide_installation.md](file:///c:/Users/yanis/Dev/Vs%20code/Traduc/guide_installation.md) pour les instructions complètes d'installation en 2 minutes.
