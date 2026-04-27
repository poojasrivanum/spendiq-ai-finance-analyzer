import re
from sklearn.base import BaseEstimator, TransformerMixin

def clean_text(text):
    text = str(text).lower()
    text = re.sub(r'[^a-z0-9\s\-\*/]', ' ', text)
    text = re.sub(r'\s+', ' ', text).strip()
    return text

class TextCleaner(BaseEstimator, TransformerMixin):
    def fit(self, X, y=None):
        return self

    def transform(self, X):
        return [clean_text(x) for x in X]