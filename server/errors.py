from werkzeug.exceptions import HTTPException

class InternalServerError(HTTPException):
	pass

class SchemaValidationError(HTTPException):
	pass

class TaxonNotFoundError(HTTPException):
    pass

class RecordAlreadyExistError(HTTPException):
    pass

class Unauthorized(HTTPException):
    pass

class Forbidden(HTTPException):
    pass

class NotFound(HTTPException):
    pass

errors = {
    "Unauthorized": {
        "message": "Unauthorized",
        "status": 401
    },
     "Forbidden": {
        "message": "Forbidden",
        "status": 403
    },
      "NotFound": {
        "message": "Not Found",
        "status": 404
    },

}