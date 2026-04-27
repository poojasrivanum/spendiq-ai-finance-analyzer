# SpendIQ 💰 — AI Financial Insights Dashboard

AI-powered financial analytics platform using ML + Flask + Firebase

## 🚀 Features
- PDF/CSV/TXT transaction parsing
- ML-based categorization (TF-IDF + Logistic Regression)
- Firebase Google Authentication
- AI chatbot for financial queries
- Budget forecasting + visual dashboard

## 🧠 ML
- Hybrid TF-IDF (word + char n-grams)
- Handles noisy UPI descriptions
- ~85–90% real-world accuracy

## 🛠 Tech Stack
- Backend: Flask (Python)
- ML: scikit-learn
- Frontend: HTML, CSS, JS
- Auth: Firebase

## ⚙️ Setup

```bash
pip install -r requirements.txt
python ml/ml_model.py   # train model
python app.py           # run server
