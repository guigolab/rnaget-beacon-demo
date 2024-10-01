from db.models import SequenceFeature, BioSample, ExpressionValue,ExpressionMatrix
from helpers import data
import csv
from celery import shared_task
import os

@shared_task(name='upload_tsv', ignore_result=False, bind=True)
def upload_tsv(self, tsv_file, parsed_matrix):

    self.update_state(state='PROGRESS', meta={'messages': ['Starting job...']})

    ##INITIALIZE VARIABLES
    new_samples_count=0
    new_features_count=0
    total_expr_values=0
    matrix = ExpressionMatrix(**parsed_matrix)
    matrix_id = matrix.matrixID
    message = None

    try:
        with open(tsv_file, mode='r') as file:
            reader = csv.reader(file, delimiter='\t')

            ##MAP HEADER
            header = next(reader)
            gene_columns, sample_columns = map_columns(header)
            
            ## we expect the first column to be the feature id
            feature_id_column = gene_columns[0] 
            expression_values, features = map_features_and_expression_values(reader, feature_id_column, sample_columns, matrix_id)
            total_expr_values = len(expression_values)

            samples = [c[0] for c in sample_columns]
            new_samples_count=len(samples)
            new_features_count=len(features)
            matrix.featuresCount=new_features_count
            matrix.biosamplesCount=new_samples_count
            self.update_state(state='PROGRESS', meta={'messages': [f'Found {matrix.featuresCount} sequences, {matrix.biosamplesCount} biosamples for matrix {matrix_id}']})

            new_features = data.map_and_update_objects(
                    SequenceFeature, 'featureID', features, matrix_id
                )
            new_samples = data.map_and_update_objects(
                    BioSample, 'biosampleID', samples, matrix_id
                )      
            self.update_state(state='PROGRESS', meta={'messages': [f'Found {matrix.featuresCount} new sequences, {matrix.biosamplesCount} new biosamples, {total_expr_values} expression values for matrix {matrix_id}']})

            model_map = {
                ExpressionValue: expression_values,
                SequenceFeature: new_features,
                BioSample:new_samples
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
        print(e)
        message = {'messages': [e]}
    finally:
        os.remove(tsv_file)
        return message

def map_features_and_expression_values(reader, feature_id_column, sample_columns, matrix_id):
    expression_values = []
    features= []
    for row in reader:
        features.append(row[feature_id_column])
        for sample_column in sample_columns:
            expression_value = {
                'featureID': row[feature_id_column],
                'biosampleID': sample_column[0],
                'matrixID': matrix_id,
                'value': row[sample_column[1]]
            }
            expression_values.append(ExpressionValue(**expression_value))
    return expression_values, features

def map_columns(header):
    gene_columns=[]
    sample_columns=[]
    for index, column in enumerate(header):
        if 'gene' in column.lower():
            gene_columns.append(index)
        else:
            sample_columns.append((column, index)) # store sampleIDs as tuple

    return gene_columns, sample_columns