@echo off
chcp 65001 >nul
title Manga Translator - Serveur Local
color 0B

echo ======================================================================
echo          MANGA TRANSLATOR - SERVEUR LOCAL DE SECOURS (SOLUTION 2)
echo ======================================================================
echo.
echo Verification de Python...
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERREUR] Python n'est pas installe ou n'est pas dans le PATH !
    echo Veuillez installer Python depuis https://www.python.org/
    pause
    exit /b 1
)

echo [OK] Python detecte.
echo.
echo Verification des dependances...
python -c "import flask, flask_cors, rapidocr_onnxruntime, PIL, cv2" >nul 2>&1
if %errorlevel% neq 0 (
    echo Installation des packages necessaires (patientez quelques secondes)...
    pip install -r requirements.txt
    if %errorlevel% neq 0 (
        echo [ERREUR] Impossible d'installer les dependances.
        pause
        exit /b 1
    )
)

echo.
echo ======================================================================
echo  Lancement du serveur sur http://127.0.0.1:5000
echo  Laissez cette fenetre ouverte pendant votre lecture de manga.
echo  Vous pouvez la minimiser dans la barre des taches.
echo ======================================================================
echo.

python server.py
pause
