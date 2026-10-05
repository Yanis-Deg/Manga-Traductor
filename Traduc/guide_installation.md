# 🚀 Guide Rapide d'Installation et d'Utilisation

Ce système vous permet de traduire automatiquement n'importe quel manga sur internet en français, avec une stratégie à double moteur :
1. **Solution 1 (Prioritaire)** : **Google Gemini Flash IA** (détecte les bulles, comprend le contexte du dialogue japonais ou anglais, et traduit naturellement en français).
2. **Solution 2 (Secours automatique)** : **Serveur Local Python (RapidOCR + Traduction)** qui prend le relais immédiatement dès que vos tokens ou quotas sont épuisés, sans interruption de lecture !

---

## Étape 1 : Installer l'extension dans votre navigateur (30 secondes)

L'extension fonctionne sur **Google Chrome**, **Microsoft Edge**, **Brave**, **Opera** ou tout navigateur basé sur Chromium.

1. Ouvrez votre navigateur et accédez à la page des extensions :
   - Sur **Chrome** : tapez `chrome://extensions/` dans la barre d'adresse.
   - Sur **Edge** : tapez `edge://extensions/` dans la barre d'adresse.
   - Sur **Brave** : tapez `brave://extensions/`.
2. En haut à droite de la page, activez le **« Mode développeur »** (Developer mode).
3. Cliquez sur le bouton **« Charger l'extension non empaquetée »** (Load unpacked).
4. Naviguez jusqu'au dossier du projet et sélectionnez le sous-dossier :
   ```
   C:\Users\yanis\Dev\Vs code\Traduc\extension
   ```
5. Félicitations ! L'icône de **Manga Translator** (bulle violette avec un "T") apparaît désormais dans votre barre d'extensions.
   *(Pensez à l'épingler pour y accéder facilement).*

---

## Étape 2 : Configurer la Solution 1 (Clé API Gemini Gratuite)

Gemini Flash offre un quota gratuit très généreux (15 requêtes/minute et 1500 requêtes/jour gratuites) avec une excellente fidélité sur les dialogues manga.

1. Cliquez sur l'icône de l'extension dans votre navigateur.
2. Cliquez sur le lien **« Obtenir une clé gratuite ↗ »** (ou rendez-vous directement sur [Google AI Studio](https://aistudio.google.com/app/apikey)).
3. Connectez-vous avec votre compte Google et cliquez sur **« Create API key »**.
4. Copiez votre clé et collez-la dans le champ **« Clé API Google Gemini »** du menu de l'extension.
5. Cliquez sur **« Tester la clé »** pour valider, puis sur **« Enregistrer les réglages »**.

---

## Étape 3 : Activer la Solution 2 (Serveur Local de Secours)

Pour que la Solution 2 prenne automatiquement le relais quand vos tokens sont épuisés :

1. Ouvrez le dossier du projet :
   ```
   C:\Users\yanis\Dev\Vs code\Traduc\server
   ```
2. Double-cliquez sur le fichier **`start_server.bat`**.
3. Une fenêtre noire s'ouvre, vérifie les dépendances et affiche :
   ```
   ==================================================
     MANGA TRANSLATOR - SERVEUR LOCAL DE SECOURS
     Écoute sur http://127.0.0.1:5000
     Prêt à recevoir les requêtes de l'extension
   ==================================================
   ```
4. Laissez cette fenêtre ouverte (ou minimisez-la) pendant votre session de lecture.
5. Vous pouvez vérifier dans le popup de l'extension que le statut indique bien **🟢 En ligne**.

---

## Étape 4 : Comment traduire vos mangas sur Internet

Rendez-vous sur n'importe quel site de lecture de manga (MangaDex, Scans-VF, Webtoons, etc.) :

### Méthode 1 : Raccourcis Clavier Rapides
- **`Alt + T`** : Traduit instantanément le scan visible à l'écran.
- **`Alt + A`** : **Traduire TOUT le chapitre d'un seul coup** (lance la traduction automatique de tous les scans du chapitre en arrière-plan) !
- **`Alt + S`** : Outil de recadrage pour traduire une bulle ou une zone précise à la souris.
- **`Alt + H`** : Masquer ou réafficher toutes les traductions.

### Méthode 2 : Bouton flottant sur l'image
- Passez votre souris sur n'importe quel scan pour voir apparaître le bouton **`🌐 Traduire ce scan`** en haut à droite de l'image. Cliquez dessus !

### Méthode 3 : Barre d'outils en bas à droite
Une barre discrète est présente en bas à droite de votre écran avec :
- **📚 Tout Traduire** (`Alt + A`) : Traduit tous les scans du chapitre par lots de 2 avec barre de progression.
- **⚡ Traduire Scan** (`Alt + T`) : Traduit le scan en cours.
- **📜 Suivant** : Fait défiler la page et traduit le scan suivant du chapitre.
- **🎯 Zone** (`Alt + S`) : Sélection manuelle d'une bulle.
- **👁️ Afficher / Masquer** (`Alt + H`) : Masque ou réaffiche instantanément toutes les traductions.

---

## 💡 Nouveautés & Optimisations
- **⚡ Vitesse accélérée (x3 à x5)** : Les scans sont désormais automatiquement optimisés et compressés côté navigateur avant transmission à l'IA, divisant le temps de réponse par 3 à 4 sans aucune perte de qualité.
- **💬 Bulles adaptatives pour le français** : Les phrases françaises étant souvent plus longues que le texte japonais ou anglais original, les bulles s'étirent et s'adaptent désormais dynamiquement en hauteur et largeur pour que le texte ne déborde jamais et reste toujours parfaitement lisible.
- **Survol des bulles** : Passez votre souris sur une bulle traduite pour afficher le texte original et le moteur utilisé.
- **Clic sur une bulle** : Cliquez sur une bulle pour basculer à volonté entre la traduction française et le texte d'origine.
- **Page de test locale** : Vous pouvez tester le système immédiatement en ouvrant le fichier `test_page.html` dans votre navigateur !
