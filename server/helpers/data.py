from bson.json_util import dumps, JSONOptions, DatetimeRepresentation


def dump_json(response_dict):
    json_options = JSONOptions()
    json_options.datetime_representation = DatetimeRepresentation.ISO8601
    return dumps(response_dict, indent=4, sort_keys=True, json_options=json_options)

def get_pagination(args):
    return int(args.get('limit', 10)), int(args.get('skip', 0))
