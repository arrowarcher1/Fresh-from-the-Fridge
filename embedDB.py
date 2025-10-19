## Simple script to run embed model and initially populate the db

import boto3
import json
import psycopg2
import pandas as pd
import os

bedrock = boto3.client('bedrock-runtime', region_name='us-east-1')

conn = psycopg2.connect(
    f"postgresql://postgres:{os.getenv('DB_PASSWORD')}@{os.getenv('DB_HOST')}:5432/recipes"
)

# Load recipes
recipes_df = pd.read_csv("recipes.csv")

# Embed & insert
curr = conn.cursor()
for idx, row in recipes_df.iterrows():
    response = bedrock.invoke_model(
        modelId='amazon.titan-embed-text-v1',
        body=json.dumps({'inputText': str(row['ingredients'])})
    )
    embedding = json.loads(response['body'].read())['embedding']

    curr.execute(
        "INSERT INTO recipes (id, name, ingredients, steps, minutes, description, embedding) VALUES (%s, %s, %s, %s, %s, %s, %s)",
        (
            int(row['id']),
            row['name'],
            str(row['ingredients']),
            str(row['steps']),
            int(row['minutes']),
            row['description'],
            embedding
        )
    )

    ##some sort of status updates
    if idx % 100 == 0:
        print(f"Processed {idx} recipes")

conn.commit()