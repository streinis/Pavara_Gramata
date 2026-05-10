from flask import Flask, request, jsonify, render_template
from google.cloud import firestore_v1, storage
import os
import uuid
import base64

os.environ["GOOGLE_CLOUD_PROJECT"] = "cookbook-494606"
db         = firestore_v1.Client(project="cookbook-494606")
gcs        = storage.Client(project="cookbook-494606")
BUCKET     = "cookbook-494606-images"
app        = Flask(__name__)


# ── Helpers ───────────────────────────────────────────────────────────────────

def migrate(r):
    r.setdefault("tags", [])
    r.setdefault("prep_time", "")
    r.setdefault("cook_time", "")
    r.setdefault("servings", 4)
    r.setdefault("notes", "")
    r.setdefault("favorite", False)
    r.setdefault("image_url", "")
    r.setdefault("public", False)
    r.setdefault("likes", [])
    if isinstance(r["tags"], str):
        r["tags"] = [t.strip().lower() for t in r["tags"].split(",") if t.strip()]
    if "ingridients" in r and "ingredients" not in r:
        r["ingredients"] = r.pop("ingridients")
    r.setdefault("ingredients", "")
    r.setdefault("recipe", "")
    return r

def device_col(device_id):
    return db.collection("devices").document(device_id).collection("recipes")

def get_device_id():
    return request.headers.get("X-Device-ID", "unknown")

def next_id(device_id):
    docs = list(device_col(device_id).stream())
    ids  = [doc.to_dict().get("id", -1) for doc in docs]
    return max(ids, default=-1) + 1

def upload_image(b64_data, filename):
    """Upload base64 image to Cloud Storage, return public URL."""
    if "," in b64_data:
        b64_data = b64_data.split(",", 1)[1]
    image_bytes = base64.b64decode(b64_data)
    bucket = gcs.bucket(BUCKET)
    blob   = bucket.blob(f"recipes/{filename}")
    blob.upload_from_string(image_bytes, content_type="image/jpeg")
    return f"https://storage.googleapis.com/{BUCKET}/recipes/{filename}"


# ── Pages ─────────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html")


# ── My recipes ────────────────────────────────────────────────────────────────

@app.route("/api/recipes", methods=["GET"])
def api_get_recipes():
    did     = get_device_id()
    docs    = device_col(did).stream()
    recipes = [migrate(doc.to_dict()) for doc in docs]
    recipes.sort(key=lambda r: (not r["favorite"], r["name"].lower()))
    return jsonify(recipes)


@app.route("/api/recipes", methods=["POST"])
def api_add_recipe():
    did  = get_device_id()
    body = request.get_json(force=True)
    nid  = next_id(did)

    image_url = ""
    if body.get("image_b64"):
        fname     = f"{did}_{nid}_{uuid.uuid4().hex[:8]}.jpg"
        image_url = upload_image(body["image_b64"], fname)

    r = {
        "id":          nid,
        "name":        body.get("name", "New Recipe"),
        "ingredients": body.get("ingredients", ""),
        "recipe":      body.get("recipe", ""),
        "notes":       body.get("notes", ""),
        "favorite":    body.get("favorite", False),
        "tags":        body.get("tags", []),
        "prep_time":   body.get("prep_time", ""),
        "cook_time":   body.get("cook_time", ""),
        "servings":    body.get("servings", 4),
        "image_url":   image_url,
        "public":      body.get("public", False),
        "likes":       [],
        "device_id":   did,
    }
    device_col(did).document(str(nid)).set(r)

    # Also write to public feed if public=True
    if r["public"]:
        pub_id = f"{did}_{nid}"
        try:
            db.collection("feed").document(pub_id).set({**r, "pub_id": pub_id})
            print(f"Feed write OK: {pub_id}")
        except Exception as e:
            print(f"Feed write ERROR: {e}")

    return jsonify(r), 201


@app.route("/api/recipes/<int:recipe_id>", methods=["PUT"])
def api_update_recipe(recipe_id):
    did  = get_device_id()
    body = request.get_json(force=True)
    doc  = device_col(did).document(str(recipe_id)).get()
    if not doc.exists:
        return jsonify({"error": "Not found"}), 404

    updated = migrate(doc.to_dict())

    # Handle new image upload
    if body.get("image_b64"):
        fname            = f"{did}_{recipe_id}_{uuid.uuid4().hex[:8]}.jpg"
        updated["image_url"] = upload_image(body["image_b64"], fname)
    body.pop("image_b64", None)

    updated.update({k: v for k, v in body.items() if k != "id"})
    updated["id"] = recipe_id
    device_col(did).document(str(recipe_id)).set(updated)

    # Sync to feed if public
    pub_id = f"{did}_{recipe_id}"
    if updated.get("public"):
        db.collection("feed").document(pub_id).set({**updated, "pub_id": pub_id})
    else:
        # Remove from feed if made private
        db.collection("feed").document(pub_id).delete()

    return jsonify(updated)


@app.route("/api/recipes/<int:recipe_id>", methods=["DELETE"])
def api_delete_recipe(recipe_id):
    did = get_device_id()
    doc = device_col(did).document(str(recipe_id)).get()
    if not doc.exists:
        return jsonify({"error": "Not found"}), 404
    if doc.to_dict().get("favorite"):
        return jsonify({"error": "Cannot delete a favourite"}), 400
    device_col(did).document(str(recipe_id)).delete()
    # Remove from feed too
    db.collection("feed").document(f"{did}_{recipe_id}").delete()
    return jsonify({"ok": True})


@app.route("/api/recipes/import", methods=["POST"])
def api_import():
    did         = get_device_id()
    body        = request.get_json(force=True)
    import_list = body if isinstance(body, list) else [body]
    nid         = next_id(did)
    added       = []
    for r in import_list:
        r = migrate(r); r["id"] = nid; nid += 1
        r["public"] = False; r["likes"] = []; r["device_id"] = did
        device_col(did).document(str(r["id"])).set(r)
        added.append(r)
    return jsonify({"imported": len(added), "recipes": added}), 201


# ── Public feed ───────────────────────────────────────────────────────────────

@app.route("/api/feed", methods=["GET"])
def api_feed():
    docs    = db.collection("feed").stream()
    recipes = [migrate(doc.to_dict()) for doc in docs]
    recipes.sort(key=lambda r: len(r.get("likes", [])), reverse=True)
    return jsonify(recipes)


@app.route("/api/feed/<pub_id>/like", methods=["POST"])
def api_like(pub_id):
    did = get_device_id()
    ref = db.collection("feed").document(pub_id)
    doc = ref.get()
    if not doc.exists:
        return jsonify({"error": "Not found"}), 404
    data  = doc.to_dict()
    likes = data.get("likes", [])
    if did in likes:
        likes.remove(did)   # unlike
    else:
        likes.append(did)   # like
    ref.update({"likes": likes})
    return jsonify({"likes": len(likes), "liked": did in likes})


@app.route("/api/feed/<pub_id>/save", methods=["POST"])
def api_save_from_feed(pub_id):
    """Save a public recipe to your own collection."""
    did = get_device_id()
    doc = db.collection("feed").document(pub_id).get()
    if not doc.exists:
        return jsonify({"error": "Not found"}), 404
    r      = migrate(doc.to_dict())
    nid    = next_id(did)
    r["id"]        = nid
    r["public"]    = False
    r["likes"]     = []
    r["device_id"] = did
    r["favorite"]  = False
    device_col(did).document(str(nid)).set(r)
    return jsonify(r), 201


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False)
