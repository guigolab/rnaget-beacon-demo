import csv
from scipy.io import mmread
from db.models import SequenceFeature, BioSample, ExpressionValue
from helpers import data
from celery import shared_task
import os

@shared_task(name='matrix_market_upload', ignore_result=False, bind=True)
def upload_matrix_market(self, mm_file, rows, columns, matrix):
    """
    :param mm_file: Matrix Market file
    :param rows: Features TSV file
    :param columns: Samples TSV file
    """
    new_samples_count=0
    new_features_count=0
    total_expr_values=0
    matrix_id = matrix.matrixID
    message = None
    self.update_state(state='PROGRESS', meta={'messages': ['Starting job...']})
    try:
    
        # Load the expression matrix
        expression_matrix = load_matrix_market(mm_file)
        # Load mappings
        features = load_tsv(rows)
        samples = load_tsv(columns)
        new_samples_count=len(samples)
        new_features_count=len(features)
        # Iterate over the matrix and populate the expression_counts
        matrix.featuresCount=new_features_count
        matrix.biosamplesCount=new_samples_count
        matrix_id = matrix.matrixID
        
        self.update_state(state='PROGRESS', meta={'messages': [f'Found {matrix.featuresCount} sequences, {matrix.biosamplesCount} biosamples for matrix {matrix_id}']})

        expression_values = map_expression_values(expression_matrix, features, samples, matrix_id)
        total_expr_values = len(expression_values)
        new_features = data.map_and_update_objects(
                SequenceFeature, 'sequenceID', features, matrix_id
            )
        new_samples = data.map_and_update_objects(
                BioSample, 'biosampleID', samples, matrix_id
            )
        self.update_state(state='PROGRESS', meta={'messages': [f'Found {matrix.featuresCount} new sequences, {matrix.biosamplesCount} new biosamples, {total_expr_values} expression values for matrix {matrix_id}']})

        #Mapping for ExpressionValue
        model_map = {
            ExpressionValue: expression_values,
            SequenceFeature: new_features,
            BioSample: new_samples,
        }

        self.update_state(state='PROGRESS', meta={'messages': ['Inserting data..']})
        #bulk insert data
        data.insert_data(model_map)
        matrix.save()
        message = {'messages': ['Job completed with the following stats',
                          f'TOTAL SAMPLES SAVED: {new_samples_count}', 
                          f'TOTAL FEATURES SAVED {new_features_count}', 
                          f'TOTAL EXPRESSION VALUES SAVED {total_expr_values}',
                          f'MATRIX SAVED {matrix_id}' ]}
        
    except Exception as e:
        message = {'messages': [e]}

    finally:
        os.remove(mm_file)
        os.remove(rows)
        os.remove(columns)

    return message
    

def map_expression_values(expression_matrix, features, samples, matrix_id):
    expression_values = []
    for gene_index, sample_index, expression_value in zip(expression_matrix.row, expression_matrix.col, expression_matrix.data):
        expression_value = {
            'biosampleID': samples[sample_index],
            'sequenceID': features[gene_index],
            'matrixID': matrix_id,
            'value': expression_value
        }
        expression_values.append(ExpressionValue(**expression_value))
    return expression_values

def load_matrix_market(file_path):
    """Load a Matrix Market file and return a sparse matrix."""
    return mmread(file_path).tocoo()  # Convert to Compressed Sparse Column format

def load_tsv(file_path):
    """Load a TSV into a list."""
    mapping = []
    with open(file_path, mode='r') as file:
        reader = csv.reader(file, delimiter='\t')
        for row in reader:
            mapping.append(row[0])
    return mapping