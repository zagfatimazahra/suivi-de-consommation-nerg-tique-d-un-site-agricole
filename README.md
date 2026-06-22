# Mise en Place d'une Solution de Suivi de Consommation Énergétique d'un Site Agricole

## Implementation of an Energy Consumption Monitoring Solution for an Agricultural Sitee

##  Master IoT — Projet de Fin d'Études

Ce projet est le mémoire de fin d'études d'un Master IoT, réalisé au sein de la société **AZURA** (site agricole). Il démontre la conception, le développement et le déploiement d'une plateforme intelligente de supervision énergétique combinant l'Internet des Objets, l'intelligence artificielle et la tarification ONEE Moyenne Tension.

| Détail                    | Information                              |
| ------------------------- | ---------------------------------------- |
| **Auteur**                | ZAGRANE Fatima zahra                     |
| **Encadrant académique**  | ABEKIRI Najib                            |
| **Encadrant entreprise**  | ABARCHID Ahmed                           |
| **Entreprise d'accueil**  | AZURA                                    |
| **Année universitaire**   | 2025–2026                                |

---

##  Aperçu du Projet (Abstract)

Ce travail explore l'application des **technologies de l'Internet des Objets (IoT)** combinées à l'**intelligence artificielle** pour la supervision énergétique d'un site agricole équipé d'une installation photovoltaïque en autoconsommation. En s'appuyant sur des **séries temporelles multivariées** issues des compteurs Schneider PowerLogic PM5300 raccordés au point de livraison ONEE et à l'onduleur photovoltaïque, l'objectif est de fournir aux exploitants un outil complet de pilotage énergétique.

La plateforme développée intègre une chaîne complète d'acquisition (Modbus RTU, RS485), un middleware de consolidation (MQTT, Node-RED), une base de données temporelle (InfluxDB Cloud), un back-end de calculs métier (FastAPI) appliquant rigoureusement la tarification ONEE Moyenne Tension (HN/HC/HP), un modèle prédictif d'apprentissage automatique (**Random Forest, R² = 0.795**) et un tableau de bord web sur mesure (React).

Une **maquette de validation indépendante**, articulée autour d'un microcontrôleur ESP32 et d'un capteur PZEM-004T, complète le dispositif et démontre la viabilité d'une chaîne logicielle alternative associant EMQX, Telegraf, InfluxDB local et Grafana.

---

##  Fonctionnalités Clés et Méthodologie

- **Acquisition Modbus RTU :** Lecture périodique des dix grandeurs électriques (tension, courant, fréquence, facteur de puissance, puissances active/réactive/apparente, énergies cumulées) sur deux compteurs Schneider PowerLogic PM5300 raccordés via bus RS485.

- **Consolidation via Node-RED :** Décodage des trames IEEE-754 Little-Endian, traitement parallèle des dix grandeurs en trois groupes, mécanisme d'accumulation et publication MQTT vers Mosquitto local.

- **Acheminement Cloud :** Script Python `bridge.py` assurant le pont entre le broker MQTT local et la base **InfluxDB Cloud** via HTTPS sécurisé.

- **Back-end FastAPI :** Plus de vingt endpoints REST exposant les calculs métier (bilan énergétique, ventilation tarifaire ONEE HN/HC/HP, bilan économique, impact CO₂, score d'état électrique 0–100).

- **Modèle Prédictif Random Forest :** Entraînement sur 17 mois d'historique avec un coefficient de détermination **R² = 0.795** et une précision opérationnelle réelle de **81,1 %** observée sur les premières journées de confrontation aux mesures.

- **Tableau de Bord React :** Sept pages fonctionnelles (Accueil, Analyse multi-grandeurs, Bilan énergétique, IA et Prédictions, Alertes, Export Excel/CSV, Login) avec rafraîchissement automatique toutes les cinq secondes.

- **Système d'Alertes :** Surveillance continue de neuf seuils paramétrables (tension, courant, puissance, facteur de puissance, puissance souscrite) avec historique et notifications visuelles.

- **Maquette de Validation :** Banc de test indépendant ESP32 + PZEM-004T mesurant un moteur monophasé, avec chaîne logicielle EMQX → Telegraf → InfluxDB → Grafana entièrement conteneurisée sous Docker.

---

##  Technologies Utilisées

| Catégorie                   | Outils / Bibliothèques                                         |
| --------------------------- | -------------------------------------------------------------- |
| **Matériel — Site**         | Schneider PowerLogic PM5300, Raspberry Pi 3, adaptateur USB-RS485 |
| **Matériel — Maquette**     | ESP32 DevKit V4, PZEM-004T v2.0, moteur monophasé XD-60, condensateur CBB60 |
| **Acquisition**             | Modbus RTU, RS485                                              |
| **Messagerie IoT**          | MQTT (Mosquitto, EMQX)                                         |
| **Middleware**              | Node-RED                                                        |
| **Bases de données**        | InfluxDB Cloud, InfluxDB local                                  |
| **Collecte & visualisation**| Telegraf, Grafana                                               |
| **Back-end**                | Python 3.x, FastAPI, Pydantic, Uvicorn                          |
| **Front-end**               | React 18, Vite, Recharts, Lucide-react, SheetJS                 |
| **Machine Learning**        | scikit-learn (Random Forest), pandas, NumPy                     |
| **Conteneurisation**        | Docker, Docker Compose                                          |
| **Firmware embarqué**       | Arduino IDE (C++), bibliothèques PZEM004T, PubSubClient  |

---

##  Résultats Clés sur 30 Jours d'Exploitation

### Bilan énergétique (période 22 mai – 21 juin 2026)

| Indicateur                      | Valeur          |
| ------------------------------- | --------------- |
| **Consommation totale du site** | 6,93 MWh        |
| **Énergie produite (solaire)**  | 3,56 MWh        |
| **Énergie achetée (ONEE)**      | 3,37 MWh        |
| **Taux d'autoconsommation**     | **51,4 %**      |
| **Économies réalisées**         | **3 778,65 DH** |
| **Projection annuelle**         | **45 973,57 DH** |
| **CO₂ évité**                   | 829,53 kg       |
| **Équivalent arbres**           | 38,2 arbres     |

### Performance du modèle prédictif

| Métrique                          | Valeur       |
| --------------------------------- | ------------ |
| **R² (validation croisée 5-fold)** | **0,795**    |
| **Précision opérationnelle réelle** | **81,1 %**   |
| **Volume d'entraînement**         | 17 mois      |
| **Algorithme**                    | Random Forest|

---

##  Mise en Place du Projet

### Prérequis

- Python 3.10+
- Node.js 18+
- Docker et Docker Compose (pour la maquette)
- Compte InfluxDB Cloud (palier gratuit suffisant)

### Installation

**1. Cloner le dépôt :**

```bash
git clone https://github.com/zagfatimazahra/AzuraEnergie_IoT_Supervision
cd AzuraEnergie_IoT_Supervision
```

**2. Configurer les variables d'environnement :**

```bash
cp .env.example .env
# Éditer .env avec vos propres tokens et identifiants
```

**3. Installer les dépendances du back-end :**

```bash
cd backend
python -m venv venv
source venv/bin/activate  # Linux/macOS
# ou .\venv\Scripts\activate  # Windows
pip install -r requirements.txt
```

**4. Installer les dépendances du front-end :**

```bash
cd ../frontend
npm install
```

### Exécution

**1. Lancer le back-end FastAPI :**

```bash
cd backend
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Le back-end sera accessible à `http://localhost:8000` et sa documentation interactive à `http://localhost:8000/docs`.

**2. Lancer le front-end React :**

```bash
cd frontend
npm run dev
```

Le tableau de bord sera accessible à `http://localhost:5173`.

**3. Lancer la maquette (optionnel) :**

```bash
cd maquette
docker compose up -d
```

Grafana sera accessible à `http://localhost:3000`.

---

## 📁 Structure du Projet

```
AzuraEnergie_IoT_Supervision/
│
├── backend/                    # Back-end FastAPI (avec modèle ML intégré)
│   ├── bridge.py                # Pont MQTT → InfluxDB Cloud
│   └── main.py                  # Application principale + Random Forest
│
├── docs/                       # Documentation et schémas
│   ├── architecture.png
│   └── circuit_maquette.png
│
├── frontend/                   # Tableau de bord React
│   ├── public/
│   │   ├── faicon.svg
│   │   └── icons.svg
│   │     
│   └── src/
│       ├── assets/
│       │    ├── hero.png
│       │    ├── logo.png
│       │    ├── react.png
│       │    └── vite.png
│       │
│       ├── components/
│       │    └── Navbar.jsx
│       │  
│       ├── pages/             # 7 pages fonctionnelles
│       │    ├── Alerts.jsx
│       │    ├── Analyse.jsx
│       │    ├── Bilan.jsx
│       │    ├── Export.jsx
│       │    ├── Home.jsx
│       │    ├── IA.jsx
│       │    └── Login.jsx
│       │  
│       ├── README.md
│       ├── index.html
│       ├── package-lock.json
│       ├── package.json 
│       └── vite.config.js               
│
├── maquette/                   # Code et configuration maquette
│   ├── code_maquette.ino
│   ├── docker-compose.yml
│   ├── grafana_dashboard.json
│   └── telegraf.conf
│
├── nodered/                    # Flows Node-RED
│   └── flow_supervision_azuraEnergie.json
└──
```

## 👤 Auteur

**ZAGRANE Fatima zahra**

Étudiant en Master d’Excellence en Ingénierie Informatique et Systèmes Embarqués (IISE) - UNIVERSITE IBN ZOHR - FACULTE DES SCIENCES - CENTRE D’EXCELLENCE IT — Projet de Fin d'Études 2025–2026

Réalisé dans le cadre du partenariat avec AZURA pour la supervision énergétique du site agricole.
