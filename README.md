# 🤖 Coach - Assistant IA Multifonctions

Assistant IA intelligent pour l'analyse de bugs, la création de contenu et bien plus.

## 🚀 Déploiement sur Render.com

### Étapes rapides :
1. **Fork/Clone** ce repository
2. **Aller sur** [render.com](https://render.com)
3. **Connecter** votre compte GitHub
4. **Sélectionner** ce repository
5. **Déployer** automatiquement avec `render.yaml`

### Variables d'environnement requises :
```bash
OAI_BASE=https://api.openai.com/v1
OAI_MODEL=gpt-3.5-turbo
OPENAI_API_KEY=votre_clé_openai_ici
PORT=5057
```

## 🐳 Déploiement Local avec Docker

```bash
# Démarrer tous les services
docker-compose up --build

# Accéder à l'application
open http://localhost:5057
```

## 🛠️ Fonctionnalités

- 🐛 **Analyse de bugs** - Debug intelligent de code
- 📝 **Rédaction** - Génération de contenu
- 🔍 **Recherche** - Assistant de recherche avancée
- 💬 **Chat** - Conversation avec IA
- 📊 **Analyses** - Rapports et insights

## 🔧 Configuration

### Fichiers de configuration :
- `memory.yaml` - Mémoire persistante
- `presets.yaml` - Prompts prédéfinis
- `sites.yaml` - Sites web favoris

### API Support :
- OpenAI GPT-3.5/4
- Ollama (local)
- Claude (Anthropic)

## 📱 Interface Web

L'application inclut une interface web moderne accessible via :
- `/` - Interface principale
- `/static/simple.html` - Interface simplifiée
- `/health` - Status de l'application

## 🔒 Sécurité

- Authentification API
- CORS configuré
- Variables d'environnement sécurisées
- Conteneurs non-root

## 📈 Monitoring

- Health checks intégrés
- Logs structurés
- Métriques de performance

---

**Créé par Matt Courchesne** | [OnlyMatt.ca](https://onlymatt.ca)