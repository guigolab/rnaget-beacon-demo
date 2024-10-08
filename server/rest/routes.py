from .biosample import biosample_controller
from .matrix import matrix_controller
from .feature import feature_controller
from .upload import uploads_controller

def initialize_routes(api):

    #BIOSAMPLE
    api.add_resource(biosample_controller.BioSamplesApi, '/api/biosamples')
    api.add_resource(biosample_controller.BioSampleApi, '/api/biosamples/<sample_id>')
    api.add_resource(biosample_controller.BioSampleMatricesApi, '/api/biosamples/<sample_id>/matrices')

    #MATRIX
    api.add_resource(matrix_controller.MatricesApi, '/api/matrices')
    api.add_resource(matrix_controller.MatrixApi, '/api/matrices/<matrix_id>')
    api.add_resource(matrix_controller.MatrixFeaturesApi, '/api/matrices/<matrix_id>/features')
    api.add_resource(matrix_controller.MatrixBiosamplesApi, '/api/matrices/<matrix_id>/biosamples')
    api.add_resource(matrix_controller.MatrixExpressionValuesApi, '/api/matrices/<matrix_id>/expression_values')

    #FEATURE
    api.add_resource(feature_controller.FeaturesApi, '/api/features')
    api.add_resource(feature_controller.FeatureApi, '/api/features/<sequence_id>')
    api.add_resource(feature_controller.FeatureMatricesApi, '/api/features/<sequence_id>/matrices')

    #MATRIX UPLOADS
    api.add_resource(uploads_controller.UploadTSVAPI, '/api/uploads/tsv')
    api.add_resource(uploads_controller.UploadMatrixMarketAPI, '/api/uploads/matrix_market')
    api.add_resource(uploads_controller.CheckJobStatusAPI, '/api/uploads/matrix_market/<task_id>', '/api/uploads/tsv/<task_id>')

    # api.add_resource(matrix_controller.MatricesApi, '/api/uploads/hdf5')
