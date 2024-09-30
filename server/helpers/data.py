from bson.json_util import dumps, JSONOptions, DatetimeRepresentation

CHUNK_SIZE=10000

def dump_json(response_dict):
    json_options = JSONOptions()
    json_options.datetime_representation = DatetimeRepresentation.ISO8601
    return dumps(response_dict, indent=4, sort_keys=True, json_options=json_options)

def get_pagination(args):
    return int(args.get('limit', 10)), int(args.get('skip', 0))

def chunk_list(data_list, chunk_size):
    """Splits a list into smaller chunks."""
    for i in range(0, len(data_list), chunk_size):
        yield data_list[i:i + chunk_size]

def map_and_update_objects(model_class, identifier_field, identifier_list, matrix_id):
    """
    Updates existing objects by appending a matrix_id and returns the list of mapped new objects.
    
    Parameters:
    model_class (MongoEngine Document): The MongoEngine document class to query and update.
    identifier_field (str): The field name to filter the objects (e.g., 'featureID', 'biosampleID').
    identifier_list (list): The list of identifiers to filter existing objects.
    matrix_id (str): The matrix ID to append to the objects.

    Returns:
    new_objects
    """
    # Find existing objects and update them
    existing_identifiers = []
    query_filter = {f"{identifier_field}__in": identifier_list}
    
    for obj in model_class.objects(**query_filter):
        obj.matrices.append(matrix_id)
        obj.save()
        existing_identifiers.append(getattr(obj, identifier_field))

    # Map new objects that don't exist yet
    new_objects = [
        model_class(**{identifier_field: identifier, 'matrices': [matrix_id]})
        for identifier in identifier_list
        if identifier not in existing_identifiers
    ]
    
    return new_objects

def insert_data(model_map):
    ##filter out existing features and samples
    for k,v in model_map.items():
        for chunk in chunk_list(v, CHUNK_SIZE):
            k.objects.insert(chunk)

# def map_beacon_response():
