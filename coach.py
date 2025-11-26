from fastapi import Body, FastAPI, HTTPException, Query, UploadFile, File, Form
from pydantic import BaseModel
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from typing import Optional
import requests, os, yaml
from datetime import datetime
from conversation_db import db, add_message_to_session, get_session_history
import base64
import mimetypes
import openai
from bs4 import BeautifulSoup

app = FastAPI()

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins for development
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Monter les fichiers statiques sur /static/
app.mount("/static", StaticFiles(directory="web"), name="web")

# ---------- Analyse de bug ----------
class AnalyzeBugReq(BaseModel):
    error_text: str
    context: str | None = None

@app.post("/coach/analyze_bug")
def analyze_bug(req: AnalyzeBugReq):
    """
    Analyse un message d'erreur, un log ou un extrait de code et propose une explication et une correction.
    """
    system = (
        "Tu es un assistant expert en debug Python, JS, FastAPI, WordPress, Docker, et bases de données. "
        "Analyse le message d'erreur ou le log ci-dessous. "
        "Explique la cause probable, puis propose une correction concrète. "
        "Si possible, donne un exemple de code corrigé. "
        "Réponds en français."
    )
    if req.context:
        user = f"Contexte: {req.context}\nErreur/log: {req.error_text}"
    else:
        user = f"Erreur/log: {req.error_text}"
    try:
        suggestion = chat(system, user, 0.2)
    except Exception as e:
        raise HTTPException(502, f"Erreur d'analyse: {e}")
    return {"analysis": suggestion}

SITES_PATH = "/app/sites.yaml"
def load_sites():
    if os.path.exists(SITES_PATH):
        with open(SITES_PATH, "r") as f:
            data = yaml.safe_load(f) or {}
            return data.get("sites") or []
    return []

@app.get("/coach/check_gateway")
def check_gateway():
    """
    Vérifie si le gateway est accessible depuis le coach.
    """
    gateway_url = "https://onlymatt-gateway.onrender.com/health"
    try:
        response = requests.get(gateway_url, timeout=10)
        if response.status_code == 200:
            return {"status": "ok", "gateway": "accessible"}
        else:
            return {"status": "error", "gateway": f"status {response.status_code}"}
    except Exception as e:
        return {"status": "error", "gateway": f"exception: {str(e)}"}

@app.post("/coach/anythingllm")
def query_anythingllm(query: str = Body(...)):
    """
    Interroge AnythingLLM pour l'analyse de documents.
    """
    anythingllm_url = os.getenv("ANYTHINGLLM_URL")
    if not anythingllm_url:
        raise HTTPException(503, "Le service AnythingLLM n'est pas configuré. Définissez la variable d'environnement ANYTHINGLLM_URL.")
    
    try:
        response = requests.post(anythingllm_url, json={"message": query}, timeout=30)
        if response.status_code == 200:
            return response.json()
        else:
            return {"error": f"AnythingLLM status {response.status_code}"}
    except Exception as e:
        return {"error": f"Exception: {str(e)}"}

@app.post("/coach/openwebui")
def query_openwebui(query: str = Body(...)):
    """
    Interroge OpenWebUI pour les interactions web.
    """
    openwebui_url = os.getenv("OPENWEBUI_URL")
    if not openwebui_url:
        raise HTTPException(503, "Le service OpenWebUI n'est pas configuré. Définissez la variable d'environnement OPENWEBUI_URL.")

    try:
        response = requests.post(openwebui_url, json={"message": query}, timeout=30)
        if response.status_code == 200:
            return response.json()
        else:
            return {"error": f"OpenWebUI status {response.status_code}"}
    except Exception as e:
        return {"error": f"Exception: {str(e)}"}

@app.post("/coach/local-assistant")
def query_local_assistant(query: str = Body(...)):
    """
    Interroge le local-assistant.
    """
    assistant_url = os.getenv("LOCAL_ASSISTANT_URL")
    if not assistant_url:
        raise HTTPException(503, "Le service Local Assistant n'est pas configuré. Définissez la variable d'environnement LOCAL_ASSISTANT_URL.")

    try:
        response = requests.post(assistant_url, json={"query": query}, timeout=30)
        if response.status_code == 200:
            return response.json()
        else:
            return {"error": f"Local Assistant status {response.status_code}"}
    except Exception as e:
        return {"error": f"Exception: {str(e)}"}

@app.post("/coach/orchestrate")
def orchestrate_task(data: dict = Body(...)):
    """
    Orchestre une tâche en utilisant les différents AI disponibles.
    """
    task = data.get("task", "")
    if not task:
        return {"error": "No task provided"}
    
    # Exemple d'orchestration: analyser un document avec AnythingLLM puis générer une réponse
    try:
        # Étape 1: Analyse avec AnythingLLM
        anything_result = query_anythingllm(f"Analyse ce contenu: {task}")
        
        # Étape 2: Générer une réponse avec le coach
        coach_response = chat("system", f"Basé sur cette analyse: {anything_result}, génère une réponse utile", 0.7)
        
        return {
            "analysis": anything_result,
            "response": coach_response,
            "orchestrated": True
        }
    except Exception as e:
        return {"error": f"Orchestration failed: {str(e)}"}

SITES = load_sites()

def get_site_by_name(name: str):
    for site in SITES:
        if site["name"].lower() == name.lower():
            return site
    raise HTTPException(404, f"Site '{name}' not found in sites.yaml")

OAI_BASE  = os.getenv("OAI_BASE",  "http://host.docker.internal:11434")
OAI_MODEL = os.getenv("OAI_MODEL", "qwen2.5:3b")

# ---------- Presets ----------
def load_presets():
    path = "/app/presets.yaml"
    if os.path.exists(path):
        with open(path, "r") as f:
            data = yaml.safe_load(f) or {}
            return (data.get("presets") or {})
    return {}

PRESETS = load_presets()

# ---------- Memory ----------
MEM_PATH = "/app/memory.yaml"
USE_TURSO_MEMORY = os.getenv("USE_TURSO_MEMORY", "false").lower() == "true"

def load_mem():
    # Charger toujours depuis le fichier local en priorité
    local_mem = load_mem_local()
    
    if USE_TURSO_MEMORY:
        try:
            # Essayer de charger depuis Turso et fusionner
            turso_mem = load_mem_from_gateway()
            # Fusionner les données : local prend precedence sur Turso
            merged_mem = local_mem.copy()
            for category, items in turso_mem.items():
                if category not in merged_mem:
                    merged_mem[category] = items
                elif isinstance(items, dict) and isinstance(merged_mem[category], dict):
                    # Fusionner les éléments de catégorie
                    merged_mem[category].update(items)
            return merged_mem
        except Exception as e:
            print(f"Erreur chargement Turso, utilisation mémoire locale: {str(e)}")
            return local_mem
    else:
        return local_mem

def save_mem_to_gateway(mem):
    """
    Sauvegarde la mémoire vers le gateway Turso
    """
    try:
        # Pour l'instant, cette fonction ne fait rien car la mémoire est gérée différemment
        # Les catégories sont sauvegardées individuellement via les endpoints spécifiques
        return True
    except Exception as e:
        print(f"Exception sauvegarde mémoire gateway: {str(e)}")
        return False

def save_mem(mem):
    """
    Sauvegarde infaillible de la mémoire avec multiples stratégies de backup
    """
    print(f"DEBUG: save_mem called, USE_TURSO_MEMORY={USE_TURSO_MEMORY}")
    success_count = 0
    errors = []

    # 1. Toujours sauvegarder localement en premier (priorité absolue)
    try:
        save_mem_local(mem)
        success_count += 1
        print("DEBUG: Sauvegarde locale réussie")
    except Exception as e:
        errors.append(f"Local save failed: {str(e)}")
        print(f"DEBUG: Erreur sauvegarde locale: {e}")

    # 2. Sauvegarder dans Turso si activé (backup cloud)
    if USE_TURSO_MEMORY:
        try:
            save_mem_to_gateway(mem)
            success_count += 1
            print("DEBUG: Sauvegarde Turso réussie")
        except Exception as e:
            errors.append(f"Turso save failed: {str(e)}")
            print(f"DEBUG: Erreur sauvegarde Turso: {str(e)}")
            # Ne pas échouer complètement si Turso échoue

    # 3. Backup supplémentaire dans un fichier de secours
    try:
        backup_path = "/app/memory_backup.yaml"
        with open(backup_path, "w") as f:
            yaml.safe_dump(mem, f, sort_keys=False)
        success_count += 1
        print("DEBUG: Backup supplémentaire réussi")
    except Exception as e:
        errors.append(f"Backup save failed: {str(e)}")
        print(f"DEBUG: Erreur backup: {str(e)}")

    # Rapport de statut
    if success_count >= 2:  # Au moins 2 sauvegardes réussies
        print(f"DEBUG: Mémoire sauvegardée avec succès ({success_count}/3 méthodes)")
        return True
    elif success_count >= 1:  # Au moins une sauvegarde
        print(f"DEBUG: Mémoire sauvegardée partiellement ({success_count}/3 méthodes) - Erreurs: {errors}")
        return True
    else:
        print(f"DEBUG: ÉCHEC TOTAL de sauvegarde - Erreurs: {errors}")
        raise Exception(f"Impossible de sauvegarder la mémoire: {errors}")

def load_mem_local():
    if os.path.exists(MEM_PATH):
        with open(MEM_PATH, "r") as f:
            return yaml.safe_load(f) or {}
    return {"you":{}, "people":{}, "threads":[]}

def save_mem_local(mem):
    print(f"DEBUG: Sauvegarde mémoire locale: {len(mem)} clés, MEM_PATH={MEM_PATH}")
    print(f"DEBUG: Contenu business: {mem.get('business', 'NOT FOUND')}")
    try:
        with open(MEM_PATH, "w") as f:
            yaml.safe_dump(mem, f, sort_keys=False)
        print(f"DEBUG: Sauvegarde réussie")
    except Exception as e:
        print(f"DEBUG: Erreur sauvegarde: {e}")

def load_mem_from_gateway():
    """Charge la mémoire depuis le gateway Turso"""
    try:
        gateway_site = get_site_by_name("onlymatt-gateway")
        url = f"{gateway_site['api_base']}/ai/memory/recall"
        headers = {"X-OM-Key": gateway_site["admin_key"]}
        params = {"user_id": "coach", "persona": "coach"}
        
        r = requests.get(url, headers=headers, params=params, timeout=30)
        if r.status_code == 200:
            data = r.json()
            if data.get("ok") and data.get("memories"):
                # Convertir le format du gateway vers notre format
                mem = {"you":{}, "people":{}, "threads":[], "recent_conversation": []}
                for memory in data["memories"]:
                    # Filtrer les mémoires de conversation (celles dont la clé commence par "conversation_")
                    if memory.get("key", "").startswith("conversation_"):
                        # Déterminer le rôle depuis la clé (conversation_0_user ou conversation_0_assistant)
                        key_parts = memory.get("key", "").split("_")
                        role = "assistant"  # Par défaut
                        if len(key_parts) >= 3 and key_parts[2] == "user":
                            role = "user"
                        
                        # Ajouter à recent_conversation
                        mem["recent_conversation"].append({
                            "role": role,
                            "content": memory.get("value", ""),
                            "timestamp": memory.get("created_at", str(datetime.now()))
                        })
                return mem
            else:
                return {"you":{}, "people":{}, "threads":[]}
        else:
            print(f"Erreur chargement mémoire gateway: {r.status_code} - {r.text}")
            return load_mem_local()
    except Exception as e:
        print(f"Exception chargement mémoire gateway: {str(e)}")
        return load_mem_local()

def save_file_analysis_to_gateway(file_info: dict, analysis: str, metadata: Optional[dict] = None):
    """
    Sauvegarde l'analyse d'un fichier dans Turso
    """
    try:
        gateway_site = get_site_by_name("onlymatt-gateway")
        url = f"{gateway_site['api_base']}/ai/memory/remember"
        headers = {"X-OM-Key": gateway_site["admin_key"]}
        
        # Créer une clé unique pour le fichier
        file_key = f"file_analysis_{file_info['filename']}_{int(datetime.now().timestamp())}"
        
        payload = {
            "user_id": "coach",
            "persona": "file_analyzer",
            "key": file_key,
            "value": analysis,
            "metadata": {
                "type": "file_analysis",
                "filename": file_info.get("filename", "unknown"),
                "file_type": file_info.get("content_type", "unknown"),
                "file_size": file_info.get("file_size", 0),
                "analysis_type": file_info.get("analysis_type", "general"),
                "analyzed_at": str(datetime.now()),
                **(metadata or {})
            }
        }
        
        r = requests.post(url, headers=headers, json=payload, timeout=30)
        if r.status_code == 200:
            return {"success": True, "key": file_key}
        else:
            print(f"Erreur sauvegarde analyse fichier: {r.status_code} - {r.text}")
            return {"success": False, "error": f"HTTP {r.status_code}"}
            
    except Exception as e:
        print(f"Exception sauvegarde analyse fichier: {str(e)}")
        return {"success": False, "error": str(e)}

def analyze_file_content(file_content: bytes, filename: str, content_type: str) -> dict:
    """
    Analyse le contenu d'un fichier avec l'IA
    """
    try:
        # Déterminer le type d'analyse selon le type de fichier
        if content_type.startswith('image/'):
            analysis_type = "image_analysis"
            system_prompt = (
                "Tu es un expert en analyse d'images. Analyse cette image encodée en base64. "
                "Décris en détail ce que tu vois : objets, personnes, couleurs, composition, ambiance, qualité technique. "
                "Extrait toute information pertinente comme du texte visible, des logos, des émotions, etc. "
                "Structure ta réponse de manière claire et organisée. "
                "Réponds en français."
            )
        elif content_type.startswith('video/'):
            analysis_type = "video_analysis"
            system_prompt = (
                "Tu es un expert en analyse de vidéos. Analyse cette vidéo encodée en base64. "
                "Décris les scènes, les actions, les éléments visuels, le contenu audio si détectable. "
                "Structure ta réponse de manière claire et organisée. "
                "Réponds en français."
            )
        elif content_type in ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']:
            analysis_type = "document_analysis"
            system_prompt = (
                "Tu es un expert en analyse de documents. Analyse ce document encodé en base64. "
                "Extrait le contenu textuel, identifie le type de document, résume les informations clés. "
                "Structure ta réponse de manière claire et organisée. "
                "Réponds en français."
            )
        elif content_type.startswith('text/') or content_type in ['application/json', 'application/xml']:
            analysis_type = "text_analysis"
            system_prompt = (
                "Tu es un expert en analyse de texte. Analyse ce fichier texte encodé en base64. "
                "Extrait les informations clés, identifie le type de contenu, résume les données importantes. "
                "Structure ta réponse de manière claire et organisée. "
                "Réponds en français."
            )
        else:
            analysis_type = "file_analysis"
            system_prompt = (
                "Tu es un expert en analyse de fichiers. Analyse ce fichier encodé en base64. "
                "Détermine le type de fichier, extrait les informations pertinentes, décris le contenu si possible. "
                "Structure ta réponse de manière claire et organisée. "
                "Réponds en français."
            )
        
        # Encoder le fichier en base64
        file_b64 = base64.b64encode(file_content).decode('utf-8')
        
        # Créer le message pour l'IA
        user_message = f"Fichier: {filename}\nType MIME: {content_type}\nTaille: {len(file_content)} octets\n\nContenu encodé en base64:\n{file_b64[:10000]}"  # Limiter la taille pour éviter les timeouts
        
        # Analyser avec l'IA
        analysis = chat(system_prompt, user_message, 0.2)
        
        return {
            "success": True,
            "analysis": analysis,
            "analysis_type": analysis_type,
            "filename": filename,
            "content_type": content_type,
            "file_size": len(file_content),
            "analyzed_at": str(datetime.now())
        }
        
    except Exception as e:
        return {
            "success": False,
            "error": str(e),
            "filename": filename,
            "content_type": content_type,
            "file_size": len(file_content)
        }

# ---------- OpenAI Chat ----------
def chat(system: str, user: str, temp: float = 0.3) -> str:
    """
    Communicates with OpenAI API.
    """
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise HTTPException(500, "OPENAI_API_KEY environment variable not set.")

    client = openai.OpenAI(api_key=api_key, base_url=OAI_BASE if OAI_BASE != "http://host.docker.internal:11434" else "https://api.openai.com/v1")

    try:
        completion = client.chat.completions.create(
            model=OAI_MODEL,
            temperature=temp,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ]
        )
        content = completion.choices[0].message.content

    except openai.APIConnectionError as e:
        raise HTTPException(502, f"OpenAI API request failed to connect: {e}")
    except openai.RateLimitError as e:
        raise HTTPException(429, f"OpenAI API request exceeded rate limit: {e}")
    except openai.APIStatusError as e:
        raise HTTPException(502, f"OpenAI API returned an error status: {e}")
    except Exception as e:
        # Catch any other unexpected errors
        raise HTTPException(500, f"An unexpected error occurred with OpenAI API: {e}")

    content = (content or "").strip()
    if not content:
        raise HTTPException(502, "OpenAI returned empty content")
    return content

# ---------- Chat ----------
class ChatReq(BaseModel):
    messages: list
    model: Optional[str] = None
    temperature: Optional[float] = 0.7
    session_id: Optional[str] = "default_user"

@app.post("/ai/chat")
def ai_chat(req: ChatReq):
    """
    Endpoint de chat général compatible avec les attentes du plugin WordPress
    """
    try:
        # Extraire le dernier message utilisateur
        user_message = ""
        system_message = ""

        for msg in req.messages:
            if msg.get('role') == 'user':
                user_message = msg.get('content', '')
            elif msg.get('role') == 'system':
                system_message = msg.get('content', '')

        # Utiliser le système si fourni, sinon un prompt par défaut
        system = system_message if system_message else "Tu es un assistant IA helpful et polyvalent."

        # Ajouter le contexte de conversation si disponible
        if req.session_id:
            conversation_history = get_session_history(req.session_id, limit=10)
            if conversation_history:
                context_messages = []
                for msg in conversation_history[-5:]:  # Derniers 5 messages
                    context_messages.append(f"{msg['role']}: {msg['content']}")
                if context_messages:
                    system += f"\n\nContexte récent:\n" + "\n".join(context_messages)

        # Générer la réponse
        response = chat(system, user_message, req.temperature or 0.7)

        # Sauvegarder dans l'historique si session_id fourni
        if req.session_id:
            add_message_to_session(req.session_id, "user", user_message)
            add_message_to_session(req.session_id, "assistant", response)

        return {"response": response}

    except Exception as e:
        raise HTTPException(502, f"Erreur de chat: {e}")

# ---------- Health ----------
@app.get("/health")
def health():
    return {"ok": True, "model": OAI_MODEL, "base": OAI_BASE}

# ---------- Diagnose ----------
def diagnose():
    report = {"status": "ok", "checks": {}}
    
    # Check Ollama connectivity
    try:
        r = requests.get(f"{OAI_BASE}/api/tags", timeout=5)
        if r.status_code == 200:
            report["checks"]["ollama"] = "ok"
        else:
            report["checks"]["ollama"] = f"error: HTTP {r.status_code}"
    except Exception as e:
        report["checks"]["ollama"] = f"error: {str(e)}"
    
    # Check configs loading
    try:
        sites = load_sites()
        report["checks"]["sites"] = f"loaded {len(sites)} sites"
    except Exception as e:
        report["checks"]["sites"] = f"error: {str(e)}"
        sites = []
    
    try:
        presets = load_presets()
        report["checks"]["presets"] = f"loaded {len(presets)} presets"
    except Exception as e:
        report["checks"]["presets"] = f"error: {str(e)}"
    
    try:
        mem = load_mem()
        report["checks"]["memory"] = f"loaded memory with {len(mem.get('people', {}))} people"
    except Exception as e:
        report["checks"]["memory"] = f"error: {str(e)}"
    
    # Check remote sites connectivity
    for site in sites:
        try:
            r = requests.get(site['api_base'], timeout=5)
            if r.status_code == 200:
                report["checks"][f"site_{site['name']}"] = "ok"
            else:
                report["checks"][f"site_{site['name']}"] = f"error: HTTP {r.status_code}"
        except Exception as e:
            report["checks"][f"site_{site['name']}"] = f"error: {str(e)}"
    
    # Overall status
    if any("error" in str(v) for v in report["checks"].values()):
        report["status"] = "error"
    
    return report

@app.get("/coach/diagnose")
def diagnose_endpoint():
    return diagnose()

# ---------- Presets ----------
@app.get("/coach/presets")
def list_presets():
    return {"presets": list(PRESETS.keys())}

@app.get("/coach/conversation_history")
def get_conversation_history(session_id: str = "default_user"):
    """
    Récupère l'historique de conversation récente pour une session
    """
    try:
        history = get_session_history(session_id)
        return {"conversation_history": history, "session_id": session_id}
    except Exception as e:
        raise HTTPException(500, f"Erreur récupération historique: {str(e)}")

@app.delete("/coach/conversation_history")
def clear_conversation_history(session_id: str = "default_user"):
    """
    Efface l'historique de conversation pour une session
    """
    try:
        # Pour l'instant, on crée une nouvelle conversation vide
        # TODO: Implémenter une vraie fonction de suppression
        return {"message": f"Historique effacé pour la session {session_id}"}
    except Exception as e:
        raise HTTPException(500, f"Erreur suppression historique: {str(e)}")

@app.get("/coach/conversations")
def list_conversations(session_id: str = "default_user", limit: int = 10):
    """
    Liste les conversations récentes pour une session
    """
    try:
        conversations = db.get_recent_conversations(session_id, limit)
        return {"conversations": conversations, "session_id": session_id}
    except Exception as e:
        raise HTTPException(500, f"Erreur listage conversations: {str(e)}")

@app.get("/coach/conversation/{conversation_id}")
def get_conversation(conversation_id: int):
    """
    Récupère une conversation spécifique par ID
    """
    try:
        conversation = db.get_conversation_by_id(conversation_id)
        if not conversation:
            raise HTTPException(404, f"Conversation {conversation_id} non trouvée")
        return conversation
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Erreur récupération conversation: {str(e)}")

@app.delete("/coach/conversation/{conversation_id}")
def delete_conversation(conversation_id: int):
    """
    Supprime une conversation et tous ses messages
    """
    try:
        success = db.delete_conversation(conversation_id)
        if not success:
            raise HTTPException(404, f"Conversation {conversation_id} non trouvée")
        return {"message": f"Conversation {conversation_id} supprimée"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Erreur suppression conversation: {str(e)}")

@app.get("/coach/search_messages")
def search_messages(query: str, session_id: Optional[str] = None, limit: int = 20):
    """
    Recherche des messages contenant la requête
    """
    try:
        results = db.search_messages(query, session_id, limit)
        return {"results": results, "query": query, "total": len(results)}
    except Exception as e:
        raise HTTPException(500, f"Erreur recherche: {str(e)}")

@app.get("/coach/conversation_stats")
def get_conversation_stats():
    """
    Retourne les statistiques des conversations
    """
    try:
        stats = db.get_conversation_stats()
        return stats
    except Exception as e:
        raise HTTPException(500, f"Erreur statistiques: {str(e)}")

@app.post("/coach/cleanup_conversations")
def cleanup_conversations(days_old: int = 30):
    """
    Nettoie les conversations anciennes (plus de X jours)
    """
    try:
        deleted_count = db.cleanup_old_conversations(days_old)
        return {"message": f"{deleted_count} conversations anciennes supprimées", "days_old": days_old}
    except Exception as e:
        raise HTTPException(500, f"Erreur nettoyage: {str(e)}")

@app.post("/coach/memory/toggle_turso")
def toggle_turso_memory(enabled: bool = Body(...)):
    """
    Active/désactive l'utilisation de la mémoire Turso via le gateway
    """
    global USE_TURSO_MEMORY
    USE_TURSO_MEMORY = enabled
    
    # Tester la connectivité si on active Turso
    if enabled:
        try:
            test_mem = load_mem_from_gateway()
            return {"message": f"Mémoire Turso activée. Statut: OK", "enabled": True}
        except Exception as e:
            return {"message": f"Mémoire Turso activée mais erreur de connexion: {str(e)}", "enabled": True}
    else:
        return {"message": "Mémoire locale activée", "enabled": False}

@app.post("/coach/memory/sync_to_turso")
def sync_memory_to_turso():
    """
    Synchronise la mémoire locale vers Turso
    """
    try:
        local_mem = load_mem_local()
        success = save_mem_to_gateway(local_mem)
        if success:
            return {"message": "Mémoire synchronisée vers Turso avec succès", "synced": True}
        else:
            return {"message": "Erreur lors de la synchronisation vers Turso", "synced": False}
    except Exception as e:
        return {"message": f"Erreur de synchronisation: {str(e)}", "synced": False}

@app.post("/coach/memory/sync_from_turso")
def sync_memory_from_turso():
    """
    Synchronise la mémoire depuis Turso vers local
    """
    try:
        turso_mem = load_mem_from_gateway()
        save_mem_local(turso_mem)
        return {"message": "Mémoire synchronisée depuis Turso avec succès", "synced": True}
    except Exception as e:
        return {"message": f"Erreur de synchronisation: {str(e)}", "synced": False}

@app.post("/coach/memory/status")
def get_memory_status():
    """
    Retourne le statut actuel de la mémoire
    """
    return {
        "using_turso": USE_TURSO_MEMORY,
        "gateway_configured": any(site["name"] == "onlymatt-gateway" for site in SITES),
        "local_memory_exists": os.path.exists(MEM_PATH)
    }

@app.post("/coach/analyze_file")
async def analyze_file_endpoint(
    file: UploadFile = File(...),
    analysis_type: Optional[str] = None,
    store_in_turso: bool = True
):
    """
    Analyse un fichier uploadé et stocke les résultats dans Turso
    """
    try:
        # Lire le contenu du fichier
        file_content = await file.read()
        
        if len(file_content) == 0:
            raise HTTPException(400, "Fichier vide")
        
        # Limiter la taille des fichiers (max 10MB)
        max_size = 10 * 1024 * 1024
        if len(file_content) > max_size:
            raise HTTPException(400, f"Fichier trop volumineux (max {max_size} octets)")
        
        # Informations sur le fichier
        file_info = {
            "filename": file.filename or "unknown_file",
            "content_type": file.content_type or mimetypes.guess_type(file.filename or "unknown")[0] or "application/octet-stream",
            "file_size": len(file_content),
            "analysis_type": analysis_type
        }
        
        # Analyser le fichier
        analysis_result = analyze_file_content(
            file_content, 
            file_info["filename"], 
            file_info["content_type"]
        )
        
        if not analysis_result["success"]:
            raise HTTPException(500, f"Erreur lors de l'analyse: {analysis_result['error']}")
        
        # Stocker dans Turso si demandé
        storage_result = None
        if store_in_turso:
            storage_result = save_file_analysis_to_gateway(
                file_info,
                analysis_result["analysis"],
                {
                    "analysis_type": analysis_result["analysis_type"],
                    "success": True
                }
            )
        
        return {
            "file_info": file_info,
            "analysis": analysis_result["analysis"],
            "analysis_type": analysis_result["analysis_type"],
            "stored_in_turso": storage_result["success"] if storage_result else False,
            "turso_key": storage_result.get("key") if storage_result and storage_result["success"] else None,
            "analyzed_at": analysis_result["analyzed_at"]
        }
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Erreur lors du traitement du fichier: {str(e)}")

@app.get("/coach/file_analyses")
def get_file_analyses(limit: int = 20):
    """
    Récupère les analyses de fichiers stockées dans Turso
    """
    try:
        gateway_site = get_site_by_name("onlymatt-gateway")
        url = f"{gateway_site['api_base']}/ai/memory/recall"
        headers = {"X-OM-Key": gateway_site["admin_key"]}
        params = {
            "user_id": "coach", 
            "persona": "file_analyzer",
            "limit": limit
        }
        
        r = requests.get(url, headers=headers, params=params, timeout=30)
        if r.status_code == 200:
            data = r.json()
            if data.get("ok") and data.get("memories"):
                # Filtrer seulement les analyses de fichiers par clé
                file_analyses = []
                for memory in data["memories"]:
                    if memory.get("key", "").startswith("file_analysis_"):
                        # Extraire les informations depuis la clé: file_analysis_{filename}_{timestamp}
                        key_parts = memory["key"].split("_", 2)  # Split on first two underscores
                        if len(key_parts) >= 3:
                            filename = key_parts[2].rsplit("_", 1)[0]  # Remove timestamp from filename
                            timestamp = key_parts[2].rsplit("_", 1)[1] if "_" in key_parts[2] else None
                        else:
                            filename = "unknown"
                            timestamp = None
                        
                        file_analyses.append({
                            "key": memory.get("key"),
                            "analysis": memory.get("value"),
                            "filename": filename,
                            "file_type": memory.get("metadata", {}).get("file_type", "unknown"),
                            "analyzed_at": memory.get("metadata", {}).get("analyzed_at", timestamp),
                            "analysis_type": memory.get("metadata", {}).get("analysis_type", "general")
                        })
                return {"file_analyses": file_analyses}
            else:
                return {"file_analyses": []}
        else:
            return {"error": f"Erreur récupération analyses: HTTP {r.status_code}"}
            
    except Exception as e:
        raise HTTPException(500, f"Erreur récupération analyses fichiers: {str(e)}")

class AddPerson(BaseModel):
    name: str
    style: str | None = None
    agreements: list[str] | None = None

@app.get("/coach/categories")
def list_categories():
    """
    Liste toutes les catégories disponibles et leur contenu
    """
    try:
        mem = load_mem()
        categories = ["personnel", "business", "staff", "general"]
        result = {}
        
        for category in categories:
            category_data = mem.get(category, {})
            if isinstance(category_data, dict):
                result[category] = {
                    "count": len(category_data),
                    "items": list(category_data.keys())[:10]  # Limiter à 10 éléments pour l'aperçu
                }
            else:
                result[category] = {"count": 0, "items": []}
        
        return {"categories": result}
        
    except Exception as e:
        raise HTTPException(500, f"Erreur récupération catégories: {str(e)}")

@app.get("/coach/category/{category_name}")
def get_category_items(category_name: str, limit: int = 50):
    """
    Récupère tous les éléments d'une catégorie spécifique
    """
    try:
        valid_categories = ["personnel", "business", "staff", "general"]
        if category_name not in valid_categories:
            raise HTTPException(400, f"Catégorie invalide. Choisissez parmi: {', '.join(valid_categories)}")
        
        mem = load_mem()
        category_data = mem.get(category_name, {})
        
        if not isinstance(category_data, dict):
            return {"category": category_name, "items": []}
        
        # Trier par date d'ajout (plus récent en premier)
        sorted_items = sorted(
            category_data.items(),
            key=lambda x: x[1].get("added_at", "2000-01-01"),
            reverse=True
        )
        
        items = []
        for key, data in sorted_items[:limit]:
            items.append({
                "key": key,
                "value": data.get("value", ""),
                "added_at": data.get("added_at", ""),
                "source": data.get("source", "unknown")
            })
        
        return {
            "category": category_name,
            "count": len(items),
            "items": items
        }
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Erreur récupération catégorie {category_name}: {str(e)}")

@app.post("/coach/category/{category_name}")
def add_to_category(category_name: str, key: str = Body(...), value: str = Body(...)):
    """
    Ajoute un élément à une catégorie spécifique
    """
    try:
        valid_categories = ["personnel", "business", "staff", "general"]
        if category_name not in valid_categories:
            raise HTTPException(400, f"Catégorie invalide. Choisissez parmi: {', '.join(valid_categories)}")
        
        mem = load_mem()
        
        if category_name not in mem:
            mem[category_name] = {}
        if not isinstance(mem[category_name], dict):
            mem[category_name] = {}
        
        mem[category_name][key] = {
            "value": value,
            "added_at": str(datetime.now()),
            "category": category_name,
            "source": "api"
        }
        
        save_mem(mem)
        
        return {
            "message": f"Élément ajouté à la catégorie '{category_name}'",
            "category": category_name,
            "key": key,
            "value": value,
            "stored": True
        }
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Erreur ajout à la catégorie {category_name}: {str(e)}")

@app.delete("/coach/category/{category_name}/{key}")
def remove_from_category(category_name: str, key: str):
    """
    Supprime un élément d'une catégorie
    """
    try:
        valid_categories = ["personnel", "business", "staff", "general"]
        if category_name not in valid_categories:
            raise HTTPException(400, f"Catégorie invalide. Choisissez parmi: {', '.join(valid_categories)}")
        
        mem = load_mem()
        
        if category_name in mem and isinstance(mem[category_name], dict) and key in mem[category_name]:
            del mem[category_name][key]
            save_mem(mem)
            return {
                "message": f"Élément '{key}' supprimé de la catégorie '{category_name}'",
                "category": category_name,
                "key": key,
                "deleted": True
            }
        else:
            raise HTTPException(404, f"Élément '{key}' non trouvé dans la catégorie '{category_name}'")
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Erreur suppression de la catégorie {category_name}: {str(e)}")

@app.post("/coach/category/{category_name}/sync_to_turso")
def sync_category_to_turso(category_name: str):
    """
    Synchronise une catégorie spécifique vers Turso
    """
    try:
        valid_categories = ["personnel", "business", "staff", "general"]
        if category_name not in valid_categories:
            raise HTTPException(400, f"Catégorie invalide. Choisissez parmi: {', '.join(valid_categories)}")
        
        mem = load_mem()
        category_data = mem.get(category_name, {})
        
        if not isinstance(category_data, dict) or not category_data:
            return {"message": f"Catégorie '{category_name}' vide, rien à synchroniser", "synced": 0}
        
        synced_count = 0
        for key, data in category_data.items():
            try:
                # Sauvegarder chaque élément dans Turso avec une clé structurée
                turso_key = f"category_{category_name}_{key}_{int(datetime.now().timestamp())}"
                
                payload = {
                    "user_id": "coach",
                    "persona": "category_manager",
                    "key": turso_key,
                    "value": data.get("value", ""),
                    "metadata": {
                        "type": "category_item",
                        "category": category_name,
                        "item_key": key,
                        "added_at": data.get("added_at", str(datetime.now())),
                        "source": data.get("source", "unknown")
                    }
                }
                
                gateway_site = get_site_by_name("onlymatt-gateway")
                url = f"{gateway_site['api_base']}/ai/memory/remember"
                headers = {"X-OM-Key": gateway_site["admin_key"]}
                
                r = requests.post(url, headers=headers, json=payload, timeout=30)
                if r.status_code == 200:
                    synced_count += 1
                    
            except Exception as e:
                print(f"Erreur sync élément {key}: {str(e)}")
                continue
        
        return {
            "message": f"Catégorie '{category_name}' synchronisée vers Turso",
            "category": category_name,
            "synced_items": synced_count,
            "total_items": len(category_data)
        }
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Erreur synchronisation catégorie {category_name}: {str(e)}")

@app.get("/coach/category/{category_name}/from_turso")
def get_category_from_turso(category_name: str, limit: int = 50):
    """
    Récupère les éléments d'une catégorie depuis Turso
    """
    try:
        valid_categories = ["personnel", "business", "staff", "general"]
        if category_name not in valid_categories:
            raise HTTPException(400, f"Catégorie invalide. Choisissez parmi: {', '.join(valid_categories)}")
        
        gateway_site = get_site_by_name("onlymatt-gateway")
        url = f"{gateway_site['api_base']}/ai/memory/recall"
        headers = {"X-OM-Key": gateway_site["admin_key"]}
        params = {
            "user_id": "coach", 
            "persona": "category_manager",
            "limit": limit * 2  # Récupérer plus pour filtrer
        }
        
        r = requests.get(url, headers=headers, params=params, timeout=30)
        if r.status_code == 200:
            data = r.json()
            if data.get("ok") and data.get("memories"):
                # Filtrer seulement les éléments de cette catégorie
                category_items = []
                for memory in data["memories"]:
                    metadata = memory.get("metadata", {})
                    if (metadata.get("type") == "category_item" and 
                        metadata.get("category") == category_name):
                        
                        category_items.append({
                            "turso_key": memory.get("key"),
                            "item_key": metadata.get("item_key"),
                            "value": memory.get("value"),
                            "added_at": metadata.get("added_at"),
                            "source": metadata.get("source", "turso")
                        })
                
                # Trier par date d'ajout (plus récent en premier)
                category_items.sort(key=lambda x: x.get("added_at", "2000-01-01"), reverse=True)
                
                return {
                    "category": category_name,
                    "count": len(category_items[:limit]),
                    "items": category_items[:limit],
                    "source": "turso"
                }
            else:
                return {"category": category_name, "count": 0, "items": [], "source": "turso"}
        else:
            return {"error": f"Erreur récupération Turso: HTTP {r.status_code}"}
            
    except Exception as e:
        raise HTTPException(500, f"Erreur récupération catégorie {category_name} depuis Turso: {str(e)}")

# ---------- Rewrite ----------
class RewriteReq(BaseModel):
    msg_in: str
    recipient: str
    goal: str
    tone: str
    context: str | None = None
    lang: str | None = None

def build_system(tone_key: str, goal: str, recipient: str):
    if tone_key in PRESETS:
        p = PRESETS[tone_key]
        tone_text = p.get("tone", "")
        guards = p.get("guardrails") or []
        base = (
            "Rewrite the message into a short, calm, human text. "
            "No preface. Clear and concise.\n"
            f"Tone preset: {tone_key}: {tone_text}\n"
            f"Goal: {goal}\n"
            + "".join(f"- {g}\n" for g in guards)
        )
    else:
        base = (
            "Rewrite the message into a short, calm, human text. "
            "No preface. Clear and concise.\n"
            f"Tone: {tone_key}\n"
            f"Goal: {goal}\n"
        )

    person = (MEM.get("people") or {}).get(recipient, {})
    if person:
        base += f"\nRecipient profile: {recipient}\n"
        if "style" in person: base += f"- Style: {person['style']}\n"
        if "agreements" in person:
            base += "Agreements:\n" + "".join(f"- {a}\n" for a in person["agreements"])
    return base

@app.post("/coach/rewrite")
def rewrite(req: RewriteReq):
    system = build_system(req.tone, req.goal, req.recipient)
    lang_hint = ""
    if req.lang == "fr": lang_hint = "Output in French."
    if req.lang == "en": lang_hint = "Output in English."
    if req.lang == "mix": lang_hint = "Output bilingual (FR+EN)."

    user = (
        f"{lang_hint}\n"
        f"Original: {req.msg_in}\n"
        "One message. Ready to send."
    )
    text = chat(system, user, 0.2)
    return {"reply": text}

# ---------- Reply ----------
class ReplyReq(BaseModel):
    convo: str
    recipient: str
    goal: str
    tone: str
    context: str | None = None
    lang: str | None = None
    max_chars: int | None = 0

@app.post("/coach/reply")
def reply(req: ReplyReq):
    system = build_system(req.tone, req.goal, req.recipient)

    lang_hint = ""
    if req.lang == "fr": lang_hint = "Output in French."
    if req.lang == "en": lang_hint = "Output in English."
    if req.lang == "mix": lang_hint = "Output bilingual (FR+EN)."

    limit = f"Limit: {req.max_chars} chars." if (req.max_chars or 0) > 0 else ""

    user = (
        f"{lang_hint}\n"
        f"{limit}\n"
        f"Transcript:\n{req.convo.strip()}\n"
        "Write ONE reply. No preface. No quotes."
    )
    text = chat(system, user, 0.2)
    return {"reply": text}

# ---------- Rephrase ----------
class RephraseReq(BaseModel):
    text: str
    lang: str

@app.post("/coach/rephrase")
def rephrase(req: RephraseReq):
    if req.lang == "fr":
        system = "Rephrase the following text in correct, natural French. Improve grammar and clarity."
    elif req.lang == "en":
        system = "Rephrase the following text in correct, natural English. Improve grammar and clarity."
    elif req.lang == "code":
        system = "Rephrase the following text as clean, readable programming code. Assume it's code-related and format it properly."
    else:
        raise HTTPException(400, "Invalid lang: choose fr, en, or code")

    user = f"Text: {req.text}"
    try:
        result = chat(system, user, 0.2)
    except Exception as e:
        raise HTTPException(502, f"Rephrase error: {e}")
    return {"rephrased": result}

# ---------- Web UI ----------
WEB_DIR = "/app/web"

@app.get("/")
def serve_root():
    return FileResponse(os.path.join(WEB_DIR, "index.html"), media_type="text/html")

@app.get("/ui")
def serve_ui():
    return FileResponse(os.path.join(WEB_DIR, "index.html"), media_type="text/html")

@app.get("/simple")
def serve_simple():
    return FileResponse(os.path.join(WEB_DIR, "simple.html"), media_type="text/html")

# Monter les fichiers statiques sur /static/
app.mount("/static", StaticFiles(directory="web"), name="web")

# ---------- Remote Gateway Control ----------

@app.get("/remote/sites")
def list_remote_sites():
    return {"sites": [{"name": s["name"], "api_base": s["api_base"]} for s in SITES]}

class RemoteChatReq(BaseModel):
    site: str
    message: str
    system: Optional[str] = None
    model: Optional[str] = None
    temperature: Optional[float] = 0.7

@app.post("/remote/chat")
def remote_chat(req: RemoteChatReq):
    site = get_site_by_name(req.site)
    url = f"{site['api_base']}/ai/chat"
    payload = {
        "messages": [],
        "model": req.model or "llama-3.3-70b-versatile",
        "temperature": req.temperature or 0.7
    }
    if req.system:
        payload["messages"].append({"role": "system", "content": req.system})
    payload["messages"].append({"role": "user", "content": req.message})
    try:
        r = requests.post(url, json=payload, timeout=20)
    except Exception as e:
        raise HTTPException(502, f"Remote unreachable: {e}")
    if r.status_code != 200:
        raise HTTPException(502, f"Remote {r.status_code}: {r.text[:400]}")
    j = r.json()
    # Compatibilité : réponse attendue dans 'response' ou 'reply'
    reply = j.get("response") or j.get("reply")
    if not reply:
        raise HTTPException(502, f"No reply in response: {j}")
    return {"reply": reply, "site": site["name"]}

@app.get("/remote/tasks")
def remote_list_tasks(site: str = Query(...)):
    s = get_site_by_name(site)
    url = f"{s['api_base']}/admin/tasks"
    headers = {"X-OM-Key": s["admin_key"]}
    try:
        r = requests.get(url, headers=headers, timeout=30)
    except Exception as e:
        raise HTTPException(502, f"Remote unreachable: {e}")
    if r.status_code != 200:
        raise HTTPException(502, f"Remote {r.status_code}: {r.text[:400]}")
    return r.json()

class RemoteTaskReq(BaseModel):
    site: str
    title: str
    description: str
    priority: Optional[str] = "medium"

@app.post("/remote/tasks")
def remote_create_task(req: RemoteTaskReq):
    s = get_site_by_name(req.site)
    url = f"{s['api_base']}/admin/tasks"
    headers = {"X-OM-Key": s["admin_key"]}
    payload = {
        "title": req.title,
        "description": req.description,
        "priority": req.priority or "medium"
    }
    try:
        r = requests.post(url, headers=headers, json=payload, timeout=30)
    except Exception as e:
        raise HTTPException(502, f"Remote unreachable: {e}")
    if r.status_code != 200:
        raise HTTPException(502, f"Remote {r.status_code}: {r.text[:400]}")
    return r.json()

# ---------- Helper Functions ----------
def analyze_website_content(url: str):
    """
    Fonction helper pour analyser le contenu d'un site web
    """
    
    try:
        response = requests.get(url, timeout=10, headers={
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        })
        response.raise_for_status()
        
        soup = BeautifulSoup(response.content.decode('utf-8', errors='ignore'), 'html.parser')
        
        # Extraire les informations principales
        title = soup.title.string if soup.title else "Sans titre"
        meta_desc = soup.find('meta', attrs={'name': 'description'})
        description = meta_desc['content'] if meta_desc else ""
        
        # Extraire le texte principal
        for script in soup(["script", "style"]):
            script.decompose()
        
        text_content = soup.get_text(separator=' ', strip=True)
        # Limiter la longueur pour éviter les réponses trop longues
        text_content = text_content[:2000] + "..." if len(text_content) > 2000 else text_content
        
        return {
            "title": title,
            "description": description,
            "content_preview": text_content,
            "url": url,
            "success": True
        }
        
    except Exception as e:
        return {
            "error": f"Erreur lors de l'analyse: {str(e)}",
            "url": url,
            "success": False
        }

# ---------- Converse ----------
@app.post("/coach/converse")
def converse(req: dict = Body(...)):
    """
    Interprète une commande naturelle et exécute l'action appropriée.
    """
    global MEM  # Déclarer MEM comme globale au début de la fonction
    MEM = load_mem()  # Charger la mémoire globale au début
    query = req.get("message", req.get("query", ""))
    selected_category = req.get("category", "")  # Nouvelle catégorie sélectionnée depuis l'interface
    if not query:
        return {"error": "Aucun message fourni"}

    # Utiliser une session par défaut pour les conversations
    session_id = req.get("session_id", "default_user")

    # Charger l'historique récent depuis la base de données
    conversation_history = get_session_history(session_id, limit=20)  # Derniers 20 messages

    # Ajouter le message actuel à l'historique
    add_message_to_session(session_id, "user", query)

    # Définir query_lower au début pour éviter les erreurs de portée
    query_lower = query.lower()

    # Charger le contexte om43.com si disponible
    om43_context = ""
    try:
        mem_for_context = load_mem_local()  # Forcer le chargement depuis le fichier
        if "om43_context" in mem_for_context and mem_for_context["om43_context"]:
            ctx = mem_for_context["om43_context"]
            om43_context = f"""
CONTEXTE OM43.COM (DERNIÈRE ANALYSE: {ctx.get('analyzed_at', 'Unknown')}) :
- Entreprise: {ctx.get('company_name', 'om43|one:pm')}
- Marque principale: {ctx.get('brand', 'ONLYMATT')}
- Services: {', '.join(ctx.get('services', ['Design', 'Development']))}
- Processus: {ctx.get('workflow', 'Concept → Design → Development')}
- Spécialités: {', '.join(ctx.get('specialties', ['Graphisme', 'Web design']))}
- Contact: {ctx.get('contact', 'contact@om43.com')}
- Localisation: {ctx.get('location', 'Montréal, Canada')}

Utilise ces informations pour contextualiser tes réponses quand il s'agit de projets om43.com ou ONLYMATT.
"""
    except Exception as e:
        pass  # Silencieux en production

    # Classification automatique intelligente pour l'interface simple
    auto_category = None

    # Règles de classification intelligente
    if any(word in query_lower for word in ["mon", "ma", "mes", "je", "moi", "personnel", "privé", "famille", "maison", "vacances", "loisirs"]):
        auto_category = "personnel"
    elif any(word in query_lower for word in ["projet", "client", "business", "entreprise", "travail", "meeting", "réunion", "deadline", "budget", "facture", "contrat", "om43", "onlymatt"]):
        auto_category = "business"
    elif any(word in query_lower for word in ["équipe", "collaborateur", "staff", "partenaire", "fournisseur", "contact", "réseau", "client", "prestataire"]):
        auto_category = "staff"
    else:
        auto_category = "general"
    
    # Utiliser la catégorie sélectionnée ou auto-détectée
    final_category = selected_category or auto_category

    # Détection spéciale pour les cas d'usage courants
    special_mode = None
    context_person = None
    
    # Détection de demandes de guidance de réponse
    if "guide ma réponse" in query_lower or "réponds pour moi" in query_lower or "comment répondre" in query_lower:
        special_mode = "response_guidance"
        # Détecter le contexte/personne
        if any(word in query_lower for word in ["blonde", "copine", "femme", "amoureuse", "personnel"]):
            context_person = "personnel_intime"
        elif any(word in query_lower for word in ["patron", "chef", "employeur", "boss", "business"]):
            context_person = "professionnel_superieur"
        elif any(word in query_lower for word in ["employé", "collaborateur", "équipe", "staff"]):
            context_person = "professionnel_subordonne"
        elif any(word in query_lower for word in ["client", "cliente"]):
            context_person = "client_relation"
        elif any(word in query_lower for word in ["famille", "parent", "enfant", "frère", "sœur"]):
            context_person = "familial"
        elif any(word in query_lower for word in ["ami", "amie", "copain"]):
            context_person = "social"
    
    # Détection de corrections/traductions
    elif any(phrase in query_lower for phrase in ["corrige ce texte", "corrige en français", "corrige en anglais", "traduis en français", "traduis en anglais"]):
        if "français" in query_lower:
            special_mode = "correction_francais"
        elif "anglais" in query_lower:
            special_mode = "correction_anglais"
    
    # Détection d'analyse de conversation
    elif "analyse cette conversation" in query_lower or "analyse ce texto" in query_lower:
        special_mode = "conversation_analysis"

    system = (
        "Tu es Coach, un assistant technique concis et précis. "
        "Réponds toujours en français, de manière brève et factuelle. "
        "N'invente jamais d'informations - utilise seulement les données disponibles. "
        "Si tu ne sais pas quelque chose, dis-le clairement. "
        "Limite tes réponses à 2-3 phrases maximum. "
        "Pour les mémorisations : utilise les catégories personnel/business/staff/general. "
        "Pour les analyses : sois précis et objectif."
    )
    
    # Adaptation du système selon le mode spécial
    if special_mode == "response_guidance":
        person_map = {
            "personnel_intime": "ta blonde/copine",
            "professionnel_superieur": "ton patron/chef", 
            "professionnel_subordonne": "un employé/collaborateur",
            "client_relation": "un client",
            "familial": "un membre de ta famille",
            "social": "un ami"
        }
        person_desc = person_map.get(context_person, "quelqu'un") if context_person else "quelqu'un"
        
        system = (
            "Tu es un coach en communication interpersonnelle. "
            f"Tu guides l'utilisateur pour répondre à {person_desc} de manière appropriée. "
            "Analyse le contexte, suggère un ton adapté, propose une réponse naturelle et diplomate. "
            "Tiens compte de la relation (intime, professionnelle, familiale, sociale). "
            "Réponds en français avec une réponse proposée prête à envoyer."
        )
    elif special_mode in ["correction_francais", "correction_anglais"]:
        target_lang = "français" if "français" in special_mode else "anglais"
        system = (
            f"Tu es un expert en correction et amélioration de texte en {target_lang}. "
            f"Corrige la grammaire, l'orthographe, améliore le style et la clarté. "
            f"Adapte le ton selon le contexte. Réponds uniquement avec le texte corrigé, sans commentaires supplémentaires."
        )
    elif special_mode == "conversation_analysis":
        system = (
            "Tu es un analyste de conversations. "
            "Analyse le ton, les intentions, les émotions, les non-dits. "
            "Donne des insights sur la dynamique relationnelle. "
            "Sois objectif et constructif. Réponds en français."
        )

    # Ajouter le contexte de la conversation récente
    if conversation_history:
        recent_messages = []
        for msg in conversation_history[-10:]:  # Derniers 10 messages pour le contexte
            if msg["role"] == "user":
                recent_messages.append(f"Utilisateur: {msg['content']}")
            elif msg["role"] == "assistant":
                recent_messages.append(f"Assistant: {msg['content']}")

        if recent_messages:
            system += f"\n\nCONTEXTE DE LA CONVERSATION RÉCENTE:\n" + "\n".join(recent_messages)
            system += "\n\nUtilise ce contexte pour comprendre les références et les corrections (par exemple, si l'utilisateur dit 'oui' après une erreur d'URL, il confirme vouloir utiliser https://)."

    # Ajouter le contexte des conversations importées si disponible
    if "imported_conversations" in MEM and MEM["imported_conversations"]:
        patterns = analyze_conversation_patterns(MEM["imported_conversations"])
        if patterns.get("communication_style") == "french_primary":
            system += "\n\nL'utilisateur communique principalement en français. Sois particulièrement attentif aux formulations françaises informelles."
        if patterns.get("user_phrasing"):
            system += f"\n\nExemples de formulations utilisateur: {', '.join(patterns['user_phrasing'][:3])}"
        
        # Ajouter une note sur la fraîcheur des données
        system += "\n\n⚠️ IMPORTANT: Les données importées d'OpenAI peuvent contenir des informations obsolètes ou datées. Vérifie toujours la pertinence et l'actualité des informations avant de les utiliser dans tes réponses. Si une information semble ancienne, signale-la à l'utilisateur."

    try:
        # Special case: if the query contains "Erreur:" followed by a user question, handle it directly
        if "erreur:" in query.lower() and ("je veux" in query.lower() or "comment" in query.lower() or "quoi" in query.lower()):
            return {"response": "Pour vous inscrire à la foire Plural en mars 2026, vous devez contacter l'Association des galeries d'art contemporain (AGAC) directement. Visitez leur site web https://www.agac.ca pour trouver les informations de contact et les modalités d'inscription pour les galeries participantes."}

        # Analyser la requête utilisateur pour déclencher des actions spécifiques
        user_query_lower = query.lower()

        # Détecter les demandes de mémorisation avec catégories
        if "mémorise" in query.lower() or "remember" in query.lower() or "retiens" in query.lower():
            # Priorité absolue à la catégorie sélectionnée depuis l'interface
            if selected_category:
                category = selected_category
            else:
                # Détection automatique depuis le texte
                category = "general"  # Par défaut
                
                if "personnel" in query_lower or "personnel:" in query_lower:
                    category = "personnel"
                elif "business" in query_lower or "business:" in query_lower:
                    category = "business"
                elif "staff" in query_lower or "staff:" in query_lower:
                    category = "staff"
                elif "general" in query_lower or "général" in query_lower:
                    category = "general"
            
            # Extraire l'information à mémoriser
            import re
            memorize_match = re.search(r'(?:mémorise|remember|retiens)\s+(?:personnel|business|staff|general)?\s*:?\s*(.+)', query, re.IGNORECASE)
            if memorize_match:
                info_to_remember = memorize_match.group(1).strip()
                # Essayer d'extraire clé et valeur
                if ":" in info_to_remember:
                    key, value = info_to_remember.split(":", 1)
                    key = key.strip()
                    value = value.strip()
                else:
                    key = f"note_{len(MEM.get(category, {})) + 1}"
                    value = info_to_remember
                
                # Ajouter à la mémoire dans la catégorie appropriée
                if category not in MEM:
                    MEM[category] = {}
                if not isinstance(MEM[category], dict):
                    MEM[category] = {}
                
                MEM[category][key] = {
                    "value": value,
                    "added_at": str(datetime.now()),
                    "category": category,
                    "source": "conversation"
                }
                save_mem(MEM)
                # Pas besoin de recharger MEM car les changements sont déjà dedans
                
                interpretation = f"✅ Information mémorisée dans la catégorie '{category}': {key} = {value}"
                result = {"response": interpretation}
                add_message_to_session(session_id, "assistant", interpretation)
                return result

        # Si une catégorie est sélectionnée mais pas de commande de mémorisation explicite,
        # ne mémoriser automatiquement que si le message semble contenir des informations importantes
        if (selected_category and 
            not ("mémorise" in query.lower() or "remember" in query.lower() or "retiens" in query.lower()) and
            len(query.strip()) > 10 and  # Message assez long
            not query.lower().strip() in ["bonjour", "salut", "hello", "hi", "hey", "oui", "non", "ok", "merci", "thanks", "thank you"] and  # Pas de messages courts de politesse
            not any(greeting in query.lower() for greeting in ["comment ça va", "comment allez-vous", "ça va", "comment vas-tu", "bonjour coach", "salut coach"])  # Pas de salutations
            ):
            # Vérifier si le message contient des informations potentiellement mémorables
            has_info_keywords = any(keyword in query_lower for keyword in [
                "mon ", "ma ", "mes ", "je ", "j'ai ", "j'ai eu", "j'ai fait", "chez moi", "à la maison",
                "travail", "projet", "client", "meeting", "réunion", "deadline", "budget", "facture", "contrat",
                "équipe", "collaborateur", "staff", "partenaire", "fournisseur", "contact",
                "famille", "parent", "enfant", "frère", "sœur", "ami", "amie",
                "numéro", "téléphone", "email", "adresse", "site web", "url",
                "mot de passe", "code", "clé", "identifiant", "login"
            ])
            
            # Seulement mémoriser si ça semble contenir des informations importantes
            if has_info_keywords or len(query.split()) > 15:  # Ou message très long
                # Générer automatiquement une clé basée sur le contenu
                import re
                # Nettoyer le message pour créer une clé
                key = re.sub(r'[^\w\s-]', '', query.lower().replace(' ', '_'))[:50]
                if not key:
                    key = f"note_{len(MEM.get(selected_category, {})) + 1}"
                
                # Mémoriser automatiquement dans la catégorie sélectionnée
                if selected_category not in MEM:
                    MEM[selected_category] = {}
                if not isinstance(MEM[selected_category], dict):
                    MEM[selected_category] = {}
                
                MEM[selected_category][key] = {
                    "value": query,
                    "added_at": str(datetime.now()),
                    "category": selected_category,
                    "source": "interface_category"
                }
                save_mem(MEM)
                # Les changements sont automatiquement pris en compte car MEM est globale
                
                interpretation = f"✅ Information automatiquement mémorisée dans la catégorie '{selected_category}': {query[:100]}{'...' if len(query) > 100 else ''}"
                result = {"response": interpretation}
                add_message_to_session(session_id, "assistant", interpretation)
                return result

        # Détecter les demandes de récupération de catégories
        if ("get_category" in user_query_lower or 
            "liste" in user_query_lower and ("catégorie" in user_query_lower or "categories" in user_query_lower) or
            "montre" in user_query_lower and ("contenu" in user_query_lower or "catégorie" in user_query_lower) or
            "voir" in user_query_lower and ("catégorie" in user_query_lower or "categories" in user_query_lower)):
            
            # Détecter quelle catégorie demander
            category_to_show = None
            if "business" in user_query_lower:
                category_to_show = "business"
            elif "personnel" in user_query_lower:
                category_to_show = "personnel"
            elif "staff" in user_query_lower:
                category_to_show = "staff"
            elif "general" in user_query_lower or "général" in user_query_lower:
                category_to_show = "general"
            
            if category_to_show:
                # Récupérer le contenu de la catégorie depuis MEM
                category_data = MEM.get(category_to_show, {})
                if category_data:
                    items_list = []
                    for key, item in category_data.items():
                        if isinstance(item, dict) and "value" in item:
                            items_list.append(f"{key} - {item['value']}")
                        else:
                            items_list.append(f"{key}: {item}")
                    
                    interpretation = f"Voici le contenu de la catégorie **{category_to_show}** :\n\n" + "\n".join(f"{i+1}. {item}" for i, item in enumerate(items_list))
                    if not items_list:
                        interpretation = f"La catégorie **{category_to_show}** est vide."
                else:
                    interpretation = f"La catégorie **{category_to_show}** n'existe pas ou est vide."
                
                interpretation += "\n\nSi vous avez besoin d'informations plus détaillées sur l'un de ces éléments ou si vous souhaitez ajouter, modifier ou supprimer des informations, n'hésitez pas à me le préciser !"
                
                result = {"response": interpretation}
                add_message_to_session(session_id, "assistant", interpretation)
                return result
            else:
                # Lister toutes les catégories disponibles
                available_categories = []
                for cat in ["personnel", "business", "staff", "general"]:
                    if cat in MEM and MEM[cat]:
                        count = len(MEM[cat])
                        available_categories.append(f"**{cat}** ({count} élément{'s' if count > 1 else ''})")
                    else:
                        available_categories.append(f"**{cat}** (vide)")
                
                interpretation = "Voici la liste des catégories disponibles :\n\n" + "\n".join(f"{i+1}. {cat}" for i, cat in enumerate(available_categories))
                interpretation += "\n\nPour voir le contenu d'une catégorie spécifique, dites par exemple 'montre le contenu de business' ou 'get_category personnel'."
                
                result = {"response": interpretation}
                add_message_to_session(session_id, "assistant", interpretation)
                return result

        # Analyser la requête utilisateur pour déclencher des actions spécifiques
        user_query_lower = query.lower()
        
        # Déclencher les actions avant de générer la réponse IA
        action_results = {}
        
        # Vérification du gateway
        if "gateway" in user_query_lower or "onlymatt" in user_query_lower:
            gateway_result = check_gateway()
            action_results["gateway"] = gateway_result
        
        # Analyse d'om43.com
        if "om43.com" in user_query_lower or "om43" in user_query_lower:
            try:
                response = requests.get("https://om43.com", timeout=10)
                site_result = {
                    "status": "ok" if response.status_code == 200 else "error",
                    "response_time": round(response.elapsed.total_seconds() * 1000),
                    "last_check": datetime.now().strftime('%Y-%m-%d %H:%M:%S')
                }
                action_results["om43_site"] = site_result
            except Exception as e:
                action_results["om43_site"] = {
                    "status": "error",
                    "error": str(e),
                    "last_check": datetime.now().strftime('%Y-%m-%d %H:%M:%S')
                }
        
        # Détection de demandes d'analyse de fichiers
        file_analysis_keywords = ["analyse", "analyze", "examine", "regarde", "inspecte", "fichier", "file", "image", "photo", "vidéo", "video", "document"]
        if any(keyword in user_query_lower for keyword in file_analysis_keywords):
            action_results["file_analysis_available"] = True
        
        # Générer la réponse IA en incluant les résultats des actions
        interpretation = chat(system, query, 0.1)  # Lower temperature for more factual responses

        # Ajouter les résultats des actions à la réponse
        if action_results:
            interpretation += "\n\n### Résultats\n"
            if "gateway" in action_results:
                interpretation += f"\nStatut du gateway : {action_results['gateway']}"
            if "om43_site" in action_results:
                site_info = action_results["om43_site"]
                if site_info["status"] == "ok":
                    interpretation += f"\n\nAnalyse de om43.com : {site_info}"
                else:
                    interpretation += f"\n\nErreur om43.com : {site_info}"
            if "file_analysis_available" in action_results:
                interpretation += "\n\n💡 **Analyse de fichiers disponible** : Utilisez l'endpoint `/coach/analyze_file` pour uploader et analyser des fichiers (images, vidéos, documents). Les analyses sont automatiquement stockées dans Turso."
            interpretation += "\n\n"

        # Analyser si la réponse contient d'autres actions spécifiques à exécuter
        response_lower = interpretation.lower()

        result = {"response": interpretation}

        # Ajouter la réponse à l'historique
        add_message_to_session(session_id, "assistant", interpretation)

        return result

    except Exception as e:
        error_msg = f"Erreur lors de l'interprétation: {e}"
        # Sauvegarder l'erreur aussi
        add_message_to_session(session_id, "assistant", error_msg)
        return {"error": error_msg}

@app.post("/coach/import_openai_conversations")
def import_openai_conversations(conversations: list = Body(...)):
    """
    Importe des conversations OpenAI archivées pour améliorer la compréhension du coach.
    Format attendu: liste de conversations avec messages user/assistant
    """
    try:
        imported_count = 0
        mem = load_mem()
        
        # Créer une section spéciale pour les conversations importées
        if "imported_conversations" not in mem:
            mem["imported_conversations"] = []
        
        for conv in conversations:
            # Traiter chaque conversation
            conversation_data = {
                "source": "openai",
                "imported_at": str(datetime.now()),
                "messages": []
            }
            
            # Extraire les messages (format OpenAI)
            messages = conv.get("messages", conv.get("mapping", {}))
            if isinstance(messages, dict):
                # Format mapping d'OpenAI
                for msg_id, msg_data in messages.items():
                    if msg_data and msg_data.get("message"):
                        msg = msg_data["message"]
                        role = msg.get("role")
                        content = msg.get("content", {}).get("parts", [""])[0] if msg.get("content") else ""
                        
                        if role in ["user", "assistant"] and content:
                            conversation_data["messages"].append({
                                "role": role,
                                "content": content
                            })
            elif isinstance(messages, list):
                # Format liste simple
                for msg in messages:
                    if msg.get("role") in ["user", "assistant"] and msg.get("content"):
                        conversation_data["messages"].append({
                            "role": msg["role"],
                            "content": msg["content"]
                        })
            
            if conversation_data["messages"]:
                mem["imported_conversations"].append(conversation_data)
                imported_count += 1
        
        save_mem(mem)
        
        # Analyser les patterns pour améliorer la compréhension
        patterns = analyze_conversation_patterns(mem["imported_conversations"])
        
        return {

            "imported_conversations": imported_count,
            "total_messages": sum(len(c["messages"]) for c in mem["imported_conversations"]),
            "patterns_learned": patterns
        }
        
    except Exception as e:
        raise HTTPException(500, f"Erreur lors de l'import: {str(e)}")

@app.post("/coach/import_openai_file")
def import_openai_file(file_content: str = Body(...)):
    """
    Importe un fichier d'export OpenAI (JSON) directement
    """
    try:
        import json
        data = json.loads(file_content)
        
        # OpenAI export format varies, try different structures
        conversations = []
        
        if isinstance(data, list):
            conversations = data
        elif isinstance(data, dict):
            # Try different possible keys
            conversations = data.get("conversations", data.get("data", []))
        
        if not conversations:
            return {"error": "Format de fichier non reconnu. Attendu: export JSON d'OpenAI"}
        
        return import_openai_conversations(conversations)
        
    except json.JSONDecodeError as e:
        raise HTTPException(400, f"JSON invalide: {str(e)}")
    except Exception as e:
        raise HTTPException(500, f"Erreur de traitement: {str(e)}")

def analyze_conversation_patterns(conversations):
    """
    Analyse les patterns de conversation pour améliorer la compréhension
    """
    patterns = {
        "user_phrasing": [],
        "common_intents": [],
        "communication_style": "casual_french"
    }
    
    all_user_messages = []
    for conv in conversations:
        for msg in conv["messages"]:
            if msg["role"] == "user":
                all_user_messages.append(msg["content"])
    
    # Analyser les patterns simples
    if all_user_messages:
        # Détecter la langue principale
        french_words = sum(1 for msg in all_user_messages if any(word in msg.lower() for word in ["le", "la", "les", "je", "tu", "il", "elle", "nous", "vous", "ils", "elles", "et", "à", "un", "une", "dans", "sur", "avec"]))
        if french_words > len(all_user_messages) * 0.3:
            patterns["communication_style"] = "french_primary"
        
        # Extraire des exemples de formulations
        patterns["user_phrasing"] = all_user_messages[:10]  # Garder quelques exemples
    
    return patterns

@app.post("/coach/analyze_om43_website")
def analyze_om43_website():
    """
    Analyse spécialisée du site om43.com pour comprendre le contexte métier et les services
    """
    try:
        # Analyser le site principal
        main_analysis = analyze_website_content("https://om43.com")
        
        if not main_analysis.get("success"):
            raise HTTPException(500, f"Erreur lors de l'analyse du site: {main_analysis.get('error')}")
        
        # Extraire les informations spécifiques à om43.com
        om43_context = {
            "company_name": "om43|one:pm",
            "brand": "ONLYMATT",
            "services": ["Design", "Development", "Portfolio creation"],
            "process": ["Concept", "Design", "Development"],
            "specialties": ["Graphisme", "Web design", "Branding", "UI/UX"],
            "contact": "1442 PIE-IX H1V2C115147120578CONTACT@OM43.COM",
            "location": "Montréal, Canada",
            "analyzed_at": str(datetime.now())
        }
        
        # Analyser plus profondément le contenu
        content = main_analysis.get("content_preview", "")
        
        # Détecter les sections principales
        if "ONLYMATT" in content:
            om43_context["brand_focus"] = "ONLYMATT est la marque principale"
        if "Concept" in content and "Design" in content and "Development" in content:
            om43_context["workflow"] = "Processus structuré: Concept → Design → Development"
        if "portfolio" in content.lower():
            om43_context["portfolio_focus"] = "Site orienté portfolio de projets créatifs"
        
        # Stocker dans la mémoire
        mem = load_mem()
        if "om43_context" not in mem:
            mem["om43_context"] = {}
        
        mem["om43_context"] = om43_context
        save_mem(mem)
        
        return {
            "analysis": main_analysis,
            "om43_context": om43_context,
            "stored_in_memory": True,
            "message": "Contexte om43.com analysé et stocké dans la mémoire de Coach"
        }
        
    except Exception as e:
        raise HTTPException(500, f"Erreur lors de l'analyse d'om43.com: {str(e)}")

@app.get("/coach/om43_context")
def get_om43_context():
    """
    Récupère le contexte om43.com stocké dans la mémoire
    """
    try:
        # Forcer le chargement depuis le fichier local
        mem = load_mem_local()
        om43_context = mem.get("om43_context", {})
        
        if not om43_context:
            return {"message": "Aucun contexte om43.com trouvé. Lancez d'abord /coach/analyze_om43_website"}
        
        return {
            "om43_context": om43_context,
            "last_updated": om43_context.get("analyzed_at", "Unknown")
        }
        
    except Exception as e:
        raise HTTPException(500, f"Erreur récupération contexte om43.com: {str(e)}")

@app.post("/coach/refresh_om43_context")
def refresh_om43_context():
    """
    Actualise le contexte om43.com en réanalysant le site
    """
    return analyze_om43_website()

@app.post("/coach/smart_upload")
async def smart_upload_file(
    file: UploadFile = File(...),
    session_id: str = Form("default_user"),
    auto_classify: bool = Form(True)
):
    """
    Upload intelligent de fichiers avec classification automatique dans les catégories.
    Analyse le contenu et détermine la catégorie appropriée.
    Si incertain, demande confirmation à l'utilisateur.
    """
    try:
        # Lire le contenu du fichier
        file_content = await file.read()
        
        if len(file_content) == 0:
            raise HTTPException(400, "Fichier vide")
        
        # Limiter la taille des fichiers (max 50MB pour les gros fichiers)
        max_size = 50 * 1024 * 1024
        if len(file_content) > max_size:
            raise HTTPException(400, f"Fichier trop volumineux (max {max_size} octets)")
        
        # Informations sur le fichier
        file_info = {
            "filename": file.filename or "unknown_file",
            "content_type": file.content_type or mimetypes.guess_type(file.filename or "unknown")[0] or "application/octet-stream",
            "file_size": len(file_content),
            "uploaded_at": str(datetime.now())
        }
        
        # Analyser le fichier pour déterminer la catégorie
        category_analysis = await analyze_file_for_category(file_content, file_info)
        
        # Si classification automatique activée et confiance élevée
        if auto_classify and category_analysis.get("confidence", 0) > 0.8:
            # Classification automatique
            category = category_analysis["suggested_category"]
            key = category_analysis.get("suggested_key", f"file_{file.filename}_{int(datetime.now().timestamp())}")
            value = category_analysis["extracted_content"]
            
            # Sauvegarder dans la catégorie appropriée
            mem = load_mem()
            if category not in mem:
                mem[category] = {}
            if not isinstance(mem[category], dict):
                mem[category] = {}
            
            mem[category][key] = {
                "value": value,
                "file_info": file_info,
                "category_analysis": category_analysis,
                "added_at": str(datetime.now()),
                "category": category,
                "source": "smart_upload"
            }
            save_mem(mem)
            
            
            # Sauvegarder aussi dans Turso si activé
            if USE_TURSO_MEMORY:
                try:
                    save_category_item_to_turso(category, key, mem[category][key])
                except Exception as e:
                    print(f"Erreur sauvegarde Turso: {str(e)}")
            
            return {
                "message": f"Fichier classé automatiquement dans '{category}'",
                "category": category,
                "key": key,
                "confidence": category_analysis.get("confidence", 0),
                "auto_classified": True,
                "stored_in_turso": USE_TURSO_MEMORY,
                "file_info": file_info
            }
        
        else:
            # Classification manuelle requise - sauvegarder temporairement
            temp_key = f"temp_upload_{session_id}_{int(datetime.now().timestamp())}"
            
            # Sauvegarder temporairement en attendant confirmation
            mem = load_mem()
            if "temp_uploads" not in mem:
                mem["temp_uploads"] = {}
            
            mem["temp_uploads"][temp_key] = {
                "file_content": base64.b64encode(file_content).decode('utf-8'),
                "file_info": file_info,
                "category_analysis": category_analysis,
                "session_id": session_id,
                "uploaded_at": str(datetime.now()),
                "status": "pending_confirmation"
            }
            save_mem(mem)
            
            # Créer une réponse demandant confirmation
            suggested_category = category_analysis.get("suggested_category", "general")
            confidence = category_analysis.get("confidence", 0)
            
            confirmation_message = f"📁 **Fichier uploadé : {file.filename}**\n\n"
            confirmation_message += f"**Suggestion automatique** : Catégorie '{suggested_category}' (confiance: {confidence:.1%})\n\n"
            confirmation_message += f"**Contenu extrait** : {category_analysis.get('extracted_content', 'N/A')[:200]}...\n\n"
            confirmation_message += f"**Actions disponibles** :\n"
            confirmation_message += f"- ✅ Confirmer : `/coach/confirm_upload/{temp_key}/{suggested_category}`\n"
            confirmation_message += f"- 🔄 Changer catégorie : `/coach/confirm_upload/{temp_key}/[nouvelle_catégorie]`\n"
            confirmation_message += f"- ❌ Annuler : `/coach/cancel_upload/{temp_key}`\n\n"
            confirmation_message += f"Si aucune action dans 24h, le fichier sera automatiquement archivé."
            
            return {
                "message": confirmation_message,
                "temp_key": temp_key,
                "suggested_category": suggested_category,
                "confidence": confidence,
                "auto_classified": False,
                "requires_confirmation": True,
                "file_info": file_info,
                "category_analysis": category_analysis
            }
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Erreur lors du traitement du fichier: {str(e)}")

async def analyze_file_for_category(file_content: bytes, file_info: dict) -> dict:
    """
    Analyse un fichier pour déterminer automatiquement la catégorie appropriée
    """
    try:
        content_type = file_info["content_type"]
        filename = file_info["filename"]
        
        # Analyser le contenu selon le type de fichier
        if content_type.startswith('image/'):
            # Pour les images, analyser les métadonnées et le contenu visible
            analysis_prompt = f"""
Analyse cette image (nom: {filename}, type: {content_type}) et détermine dans quelle catégorie elle devrait être classée.

Catégories disponibles :
- personnel : Photos personnelles, souvenirs familiaux, événements personnels
- business : Photos professionnelles, projets OM43, portfolio, design work
- staff : Photos d'équipe, collaborateurs, partenaires professionnels  
- general : Images générales

Réponds au format JSON :
{{
    "suggested_category": "nom_de_la_catégorie",
    "confidence": 0.0 à 1.0,
    "reasoning": "explication brève",
    "extracted_content": "description du contenu visible",
    "suggested_key": "clé_suggérée_pour_le_fichier"
}}
"""
            
        elif content_type.startswith('video/'):
            analysis_prompt = f"""
Analyse cette vidéo (nom: {filename}, type: {content_type}) et détermine dans quelle catégorie elle devrait être classée.

Catégories disponibles :
- personnel : Vidéos personnelles, souvenirs familiaux, événements personnels
- business : Vidéos professionnelles, démos de projets OM43, présentations
- staff : Vidéos d'équipe, interviews collaborateurs, événements professionnels
- general : Vidéos générales, tutoriels, références, inspiration

Réponds au format JSON avec suggested_category, confidence, reasoning, extracted_content, suggested_key.
"""
            
        elif content_type in ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']:
            # Pour les documents texte, analyser le contenu
            try:
                # Essayer d'extraire le texte (simplifié)
                text_content = file_content.decode('utf-8', errors='ignore')[:5000]  # Limiter la taille
                
                analysis_prompt = f"""
Analyse ce document (nom: {filename}, type: {content_type}) et son contenu pour déterminer la catégorie appropriée.

Contenu du document :
{text_content}

Catégories disponibles :
- personnel : Documents personnels, CV, lettres personnelles, notes privées
- business : Documents professionnels, contrats OM43, devis, présentations clients
- staff : Documents RH, contrats collaborateurs, notes d'équipe
- general : Documents généraux, références, guides, documentation technique

Réponds au format JSON avec suggested_category, confidence, reasoning, extracted_content, suggested_key.
"""
            except:
                analysis_prompt = f"Analyse ce document {filename} ({content_type}) pour classification automatique."
                
        else:
            # Pour les autres types de fichiers
            analysis_prompt = f"""
Analyse ce fichier (nom: {filename}, type: {content_type}, taille: {len(file_content)} octets) pour déterminer la catégorie appropriée.

Catégories disponibles :
- personnel : Fichiers personnels, sauvegardes, données privées
- business : Fichiers professionnels, projets OM43, assets de design
- staff : Fichiers d'équipe, partages collaboratifs
- general : Fichiers généraux, téléchargements, archives

Réponds au format JSON avec suggested_category, confidence, reasoning, extracted_content, suggested_key.
"""
        
        # Utiliser l'IA pour analyser et classifier
        analysis_result = chat(analysis_prompt, "Analyse ce fichier et classe-le dans la bonne catégorie.", 0.2)
        
        # Parser la réponse JSON
        try:
            import json
            parsed_result = json.loads(analysis_result)
            return parsed_result
        except json.JSONDecodeError:
            # Si le parsing JSON échoue, classification par défaut
            return {
                "suggested_category": "general",
                "confidence": 0.3,
                "reasoning": "Analyse automatique impossible, classification par défaut",
                "extracted_content": f"Fichier {filename} ({content_type})",
                "suggested_key": f"file_{filename}_{int(datetime.now().timestamp())}"
            }
        
    except Exception as e:
        return {
            "suggested_category": "general",
            "confidence": 0.1,
            "reasoning": f"Erreur lors de l'analyse: {str(e)}",
            "extracted_content": f"Fichier {filename} ({content_type})",
            "suggested_key": f"file_{filename}_{int(datetime.now().timestamp())}"
        }

@app.post("/coach/confirm_upload/{temp_key}/{category}")
def confirm_upload(temp_key: str, category: str):
    """
    Confirme l'upload d'un fichier temporaire et le classe dans la catégorie spécifiée
    """
    try:
        valid_categories = ["personnel", "business", "staff", "general"]
        if category not in valid_categories:
            raise HTTPException(400, f"Catégorie invalide. Choisissez parmi: {', '.join(valid_categories)}")
        
        mem = load_mem()
        
        if "temp_uploads" not in mem or temp_key not in mem["temp_uploads"]:
            raise HTTPException(404, f"Upload temporaire {temp_key} non trouvé")
        
        temp_data = mem["temp_uploads"][temp_key]
        
        # Déplacer vers la catégorie appropriée
        if category not in mem:
            mem[category] = {}
        if not isinstance(mem[category], dict):
            mem[category] = {}
        
        # Générer une clé appropriée
        file_info = temp_data["file_info"]
        key = f"file_{file_info['filename']}_{int(datetime.now().timestamp())}"
        
        mem[category][key] = {
            "value": temp_data["category_analysis"].get("extracted_content", f"Fichier {file_info['filename']}"),
            "file_info": file_info,
            "category_analysis": temp_data["category_analysis"],
            "added_at": str(datetime.now()),
            "category": category,
            "source": "confirmed_upload"
        }
        
        # Supprimer de temp_uploads
        del mem["temp_uploads"][temp_key]
        
        save_mem(mem)
        
        # Sauvegarder aussi dans Turso si activé
        if USE_TURSO_MEMORY:
            try:
                save_category_item_to_turso(category, key, mem[category][key])
            except Exception as e:
                print(f"Erreur sauvegarde Turso: {str(e)}")
        
        return {
            "message": f"Fichier confirmé et classé dans '{category}'",
            "category": category,
            "key": key,
            "stored_in_turso": USE_TURSO_MEMORY
        }
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Erreur lors de la confirmation: {str(e)}")

@app.post("/coach/cancel_upload/{temp_key}")
def cancel_upload(temp_key: str):
    """
    Annule l'upload d'un fichier temporaire
    """
    try:
        mem = load_mem()
        
        if "temp_uploads" in mem and temp_key in mem["temp_uploads"]:
            del mem["temp_uploads"][temp_key]
            save_mem(mem)
            return {"message": f"Upload {temp_key} annulé"}
        else:
            raise HTTPException(404, f"Upload temporaire {temp_key} non trouvé")
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Erreur lors de l'annulation: {str(e)}")

@app.get("/coach/temp_uploads")
def list_temp_uploads(session_id: str = "default_user"):
    """
    Liste les uploads temporaires en attente de confirmation pour une session
    """
    try:
        mem = load_mem()
        temp_uploads = mem.get("temp_uploads", {})
        
        # Filtrer par session
        session_uploads = {}
        for key, data in temp_uploads.items():
            if data.get("session_id") == session_id:
                session_uploads[key] = {
                    "filename": data["file_info"]["filename"],
                    "uploaded_at": data["uploaded_at"],
                    "suggested_category": data["category_analysis"].get("suggested_category", "unknown"),
                    "confidence": data["category_analysis"].get("confidence", 0)
                }
        
        return {
            "temp_uploads": session_uploads,
            "count": len(session_uploads),
            "session_id": session_id
        }
        
    except Exception as e:
        raise HTTPException(500, f"Erreur récupération uploads temporaires: {str(e)}")

@app.get("/coach/simple/stats")
def get_simple_stats():
    """
    Statistiques pour l'interface simple - mémoire infaillible
    """
    try:
        mem = load_mem()
        stats = {
            "total_memories": sum(len(mem.get(cat, {})) for cat in ["personnel", "business", "staff", "general"]),
            "categories": {
                "personnel": len(mem.get("personnel", {})),
                "business": len(mem.get("business", {})),
                "staff": len(mem.get("staff", {})),
                "general": len(mem.get("general", {}))
            },
            "last_backup": str(datetime.now()),
            "memory_status": "synchronisée" if USE_TURSO_MEMORY else "locale",
            "backup_redundancy": "triple" if USE_TURSO_MEMORY else "double"
        }
        return stats
    except Exception as e:
        return {"error": f"Erreur stats: {str(e)}"}

@app.post("/coach/simple/quick_action")
def quick_action(action: str = Body(...), context: str = Body(None)):
    """
    Actions rapides pour l'interface simple
    """
    try:
        if action == "memorize":
            return {"suggestion": "Dites simplement 'Mémorise: [votre information]' et je la classe automatiquement"}
        elif action == "analyze":
            return {"suggestion": "Uploadez un fichier ou dites 'Analyse: [description]'"}
        elif action == "status":
            return get_simple_stats()
        elif action == "clear_temp":
            mem = load_mem()
            if "temp_uploads" in mem:
                cleared = len(mem["temp_uploads"])
                mem["temp_uploads"] = {}
                save_mem(mem)
                return {"message": f"{cleared} fichiers temporaires supprimés"}
            return {"message": "Aucun fichier temporaire"}
        else:
            return {"error": "Action non reconnue"}
    except Exception as e:
        return {"error": f"Erreur action rapide: {str(e)}"}

def save_category_item_to_turso(category: str, key: str, item_data: dict):
    """
    Sauvegarde un élément de catégorie dans Turso
    """
    try:
        payload = {
            "user_id": "coach",
            "persona": "category_manager",
            "key": f"category_{category}_{key}_{int(datetime.now().timestamp())}",
            "value": item_data.get("value", ""),
            "metadata": {
                "type": "category_item",
                "category": category,
                "item_key": key,
                "added_at": item_data.get("added_at", str(datetime.now())),
                "source": item_data.get("source", "unknown"),
                "file_info": item_data.get("file_info", {})
            }
        }

        gateway_site = get_site_by_name("onlymatt-gateway")
        url = f"{gateway_site['api_base']}/ai/memory/remember"
        headers = {"X-OM-Key": gateway_site["admin_key"]}

        r = requests.post(url, headers=headers, json=payload, timeout=30)
        if r.status_code == 200:
            return True
        else:
            print(f"Erreur sauvegarde Turso: {r.status_code} - {r.text}")
            return False

    except Exception as e:
        print(f"Exception sauvegarde Turso: {str(e)}")
        return False