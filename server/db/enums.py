from enum import Enum

class Roles(Enum):
    SAMPLE_MANAGER = 'SampleManager' # samples local (through excel) and public (biosamples)
    DATA_MANAGER = 'DataManager' # crud data
    DATA_ADMIN = 'Admin' # all actions

class CronJobStatus(Enum):
    PENDING = 'PENDING'
    DONE = 'DONE'

