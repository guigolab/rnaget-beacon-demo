import os
import subprocess, time
import tempfile
from db.models import GeneIdResults
from flask import current_app as app
import shutil

GFF2PS = '/soft/GeneID/bin/gff2ps'
GFF2PS_PARAM= '/soft/GeneID/bin/gff2ps.param'
GENEID = '/soft/GeneID/bin/geneid'

def create_tempfile(suffix,**kwargs):
    return tempfile.NamedTemporaryFile(suffix='.'+suffix,dir='/tmp',**kwargs)

def parse_params(data, files):
    #parse files
    try:
        geneid_result = GeneIdResults()
        options = list()
        options.append(GENEID)
        fasta = create_tempfile('fasta')
        files['fasta'].save(fasta.name)
        if 'evidences' in files.keys():
            gff = create_tempfile('gff')
            files['evidences'].save(gff.name)
        else:
            gff = None
        app.logger.info(data)
        param = create_tempfile('param')
        param_file = TaxaFile.objects(name=data['param']).first()
        geneid_result.param_species = param_file.organism ## name field is required
        param.write(param_file.file.read())
        options.append('-3P')
        options.append(param.name) ##param tmpfile path
        if 'options' in data:
            for value in data.getlist('options'):
                if value:
                    options.extend(value.split(","))
        if 'output' in data:
            options.append(data['output'])
        if 'mode' in data and data['mode'] == '-o':
            options.append(data['mode'])  
        if 'mode' in data.keys() and gff and gff.name:
            cmd = '-R' if data['mode'] == 'normal' or data['mode'] == '-o' else data['mode']
            options.extend([cmd, gff.name])
            fasta.seek(0)
        options.append(fasta.name)
        geneid_result.geneid_cmd = ' '.join(options)
        output = create_tempfile('stdout')
        launch_geneid(options, output, geneid_result)
        output.seek(0)
        app.logger.info(geneid_result.run_time)
    except Exception as e:
        app.logger.info(e)
        shutil.rmtree('/tmp') 

    #parse data



def programs_configs(data,files):
    geneid_result = GeneIdResults()
    param = create_tempfile('param')
    options = geneid_options(data,geneid_result,param)
    # add this line to get fasta size
    if 'fastaFile' in files.keys():
        app.logger.info('fastafile')
        fasta = create_tempfile('fasta')
        files['fastaFile'].save(fasta.name)
    elif 'fastaText' in data.keys():
        fasta = create_tempfile('fasta')
        fasta.write(data['fastaText'].encode())
        fasta.seek(0)
    if 'gffFile' in files.keys():
        gff = create_tempfile('gff')
        files['gffFile'].save(gff.name)
    elif 'gffText' in data.keys():
        gff = create_tempfile('gff')
        gff.write(data['gffText'].encode())
        gff.seek(0)
    else:
        gff = None
    if 'mode' in data.keys() and gff and gff.name:
        cmd = '-R' if data['mode'] == 'normal' or data['mode'] == '-o' else data['mode']
        options.extend([cmd, gff.name])
    psfile = create_tempfile('ps') if 'gff2ps' in data.keys() and data['gff2ps'] else None
    ##run geneid
    fasta.seek(0)
    options.append(fasta.name)
    geneid_result.geneid_cmd = ' '.join(options)
    output = create_tempfile('stdout')
    launch_geneid(options, output, geneid_result)

    app.logger.info('AFTER GENEID')

    param.close()
    output.seek(0)
    fasta.close()
    if gff:
        gff.close()
    if psfile:
        jpg = create_tempfile('jpg')
        ##run gff2ps
        psfile.write(launch_gff2ps(output))
        psfile.seek(0)

        app.logger.info('AFTER GFF2PS')
        
        os.system('convert -rotate 90 ' + psfile.name + ' ' + jpg.name) #convert ps to jpg 

        # ps_file = ResultFiles(file=psfile, type='application/PostScript', name = psfile.name).save()
        # jpg_file = ResultFiles(file=jpg, type='image/jpg', name=jpg.name).save()
        geneid_result.ps = ps_file
        geneid_result.jpg = jpg_file
        psfile.close()
        jpg.close()
    try:
        if os.path.getsize(output.name) >= 15000000:
            # output_file = ResultFiles(file = output, type='text/plain', name = output.name).save()
            geneid_result.output_file = output_file
        else:
            with open(output.name, 'r') as output:
                geneid_result.output = "\n".join(output.readlines())
        geneid_result.save()
        
    except Exception as e:
        app.logger.error(e)
    return geneid_result
    
def launch_geneid(options,output,model):
    app.logger.info("LAUNCHING GENEID...")
    start_time = time.time()
    popen = subprocess.Popen(tuple(options), stdout=output,  stderr=output)
    while popen.poll() is None:
        time.sleep(0.5)
    end_time = time.time()
    model.run_time = str(round(end_time - start_time, 2))


def launch_gff2ps(output):
    args = (GFF2PS,'-C',GFF2PS_PARAM, output.name)
    app.logger.info("LAUNCHING GFF2PS...")
    popen = subprocess.Popen(args, stdout=subprocess.PIPE)
    ouput, error = popen.communicate()
    if ouput:
        return ouput
    elif error:
        return error
    else:
        return 

def geneid_options(data,geneid_model,param):
    options= []
    options.append(GENEID)
    param_file = TaxonFile.objects(name=data['param']).first()
    geneid_model.param_species = param_file.organism.fetch().name ## name field is required
    param.write(param_file.file.read())
    options.append('-P')
    options.append(param.name) ##param tmpfile path
    if 'options' in data:
        for value in data.getlist('options'):
            if value:
                options.extend(value.split(","))
    if 'output' in data:
        options.append(data['output'])
    if 'mode' in data and data['mode'] == '-o':
        options.append(data['mode'])  
    return options

