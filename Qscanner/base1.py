import csv
from datetime import datetime, timezone
import os
from flask import Flask, Response, jsonify, request

# Locate the directory containing this app.py file
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")
CSV_PATH = os.path.join(BASE_DIR, "Scanned_DATA.csv")

# Initialize Flask once with standard static routing
app = Flask(__name__, static_folder=STATIC_DIR, static_url_path="/static")


def get_next_serial_number() -> int:
    """Calculates next serial number based on existing CSV rows."""
    if not os.path.isfile(CSV_PATH):
        return 1
    with open(CSV_PATH, mode="r", encoding="utf-8") as f:
        reader = csv.reader(f)
        row_count = sum(1 for _ in reader)
        return max(1, row_count)  # Excludes header count automatically


def user_data_to_csv(qr_data: str, source: str = "web_camera") -> None:
    file_exists = os.path.isfile(CSV_PATH)
    next_number = get_next_serial_number()

    with open(CSV_PATH, mode="a", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        if not file_exists:
            writer.writerow(["Serial Number", "Timestamp (UTC)", "QR_Data", "Source"])
        writer.writerow([
            next_number,
            datetime.now(timezone.utc).isoformat(),
            qr_data,
            source
        ])


@app.route("/")
def serve_app():
    js_filename = "fr.js"
    
    shell = f"""<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>QR Scanner</title>
</head>
<body>
    <script src="/static/{js_filename}"></script>
</body>
</html>"""
    return Response(shell, mimetype="text/html")


@app.post("/api/save-qr")
def save_qr():
    payload = request.get_json(silent=True) or {}
    qr_data = payload.get("qr_data")
    source = payload.get("source", "browser_js")

    if not qr_data:
        return jsonify({"status": "error", "message": "No QR data"}), 400

    user_data_to_csv(qr_data, source)
    return jsonify({"status": "success", "data": qr_data}), 200


if __name__ == "__main__":
    os.makedirs(STATIC_DIR, exist_ok=True)
    # Use port 5000 (port 500 is restricted)
#Development based IP,for actual purpose use server or device ip that going to run this python file or also make production IP address using WWVM
    app.run(host="127.0.0.1", port=5000, debug=True)