# 🚀 Guide de Déploiement sur Render avec PostgreSQL

## ✅ Ce qui a été changé

- ✅ Migration de **SQLite** → **PostgreSQL**
- ✅ Mise à jour du `package.json` : remplacement de `sqlite3` par `pg`
- ✅ Réécriture de `server.js` avec Promises et PostgreSQL
- ✅ Fichier `.env.example` créé pour la configuration

## 🎯 Étapes de déploiement sur Render

### 1️⃣ Push le code modifié
```bash
cd c:\myTicket-main
git add .
git commit -m "Migration vers PostgreSQL pour Render"
git push
```

### 2️⃣ Créer une base de données PostgreSQL sur Render

1. Va sur [render.com](https://render.com)
2. Clique sur **"New +"** → **"PostgreSQL"**
3. Configure :
   - **Name** : `camp-tickets-db`
   - **Database** : `camp_tickets`
   - **User** : `camp_user`
   - **Region** : Sélectionne une région proche
   - **Plan** : Gratuit (free tier) pour commencer

4. Une fois créée, Render fournit une URL `DATABASE_URL` comme :
   ```
   postgresql://camp_user:password@host:5432/camp_tickets
   ```
   ⚠️ **Copie cette URL**, tu en auras besoin pour le Web Service

### 3️⃣ Créer un Web Service pour le backend

1. Clique sur **"New +"** → **"Web Service"**
2. Connecte ton repository GitHub

3. Configure les paramètres :

   | Paramètre | Valeur |
   |-----------|--------|
   | **Name** | `camp-tickets-api` |
   | **Root Directory** | `backend` |
   | **Environment** | `Node` |
   | **Build Command** | `npm install` |
   | **Start Command** | `npm start` |
   | **Plan** | Gratuit (free) |

### 4️⃣ Ajouter les variables d'environnement

Dans le Web Service Render, va à l'onglet **"Environment"** et ajoute :

| Clé | Valeur |
|-----|--------|
| `DATABASE_URL` | Colle l'URL PostgreSQL du step 2 |
| `PORT` | `3000` |
| `NODE_ENV` | `production` |
| `FRONTEND_ORIGIN` | `https://ton-domaine-render.onrender.com` |

### 5️⃣ Redéployer si nécessaire

Si tu modifies les variables d'env, Render redéploie automatiquement après quelques minutes.

## 🔗 Une fois le déploiement terminé

1. Tu auras une URL comme : `https://camp-tickets-api-xxxx.onrender.com`
2. Mets à jour le `FRONTEND_ORIGIN` dans Render avec cette URL
3. Ton API est accessible à : `https://camp-tickets-api-xxxx.onrender.com/api`

## 🚨 Points importants

- ✅ La BD PostgreSQL sur Render est **persistante** (contrairement à SQLite)
- ✅ Les données restent même après un redéploiement
- ✅ Tu peux y accéder via n'importe quel client PostgreSQL si besoin
- ⚠️ Les données sont **en base de données**, plus de fichier `tickets.db`

## 📝 Variables d'environnement locales (développement)

Si tu veux tester localement avec PostgreSQL avant de déployer :

1. Crée un `.env` dans `backend/` :
   ```
   DATABASE_URL=postgresql://user:password@localhost:5432/camp_tickets
   PORT=3000
   FRONTEND_ORIGIN=http://localhost:3000
   NODE_ENV=development
   ```

2. Installe PostgreSQL localement et crée la BD

3. Démarre : `npm start`

## ✨ C'est tout !

Ton app est maintenant prête pour le déploiement sur Render ! 🎉
