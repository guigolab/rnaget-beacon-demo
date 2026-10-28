from celery import Celery

def celery_init_app(celery_config):
    celery_app = Celery("rnaget-beacon")
    celery_app.conf.update(celery_config)
    celery_app.set_default()
    return celery_app
