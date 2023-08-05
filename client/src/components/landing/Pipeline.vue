<template>
    <section class="pipeline row align-center justify-center">
        <div class="flex lg8">
            <div class="row row-equal justify-center align-center">
                <div class="flex">
                    <va-card-content>
                        <h2 class="va-h1">geneid<span>x</span></h2>
                        <p>A Nextflow pipeline that uses DIAMOND BLASTx to provide protein-coding evidences to geneid
                        </p>
                    </va-card-content>
                    <va-card-actions align="center">
                        <va-button color="secondary" icon="ion-logo-github">More info</va-button>
                        <va-button color="primary">
                            Try it now
                        </va-button>
                    </va-card-actions>
                </div>
                <div class="flex md12 sm12 xs12">
                    <va-card class="row">
                        <div class="schema-image flex lg6 md6 sm12 xs12">
                            <va-image lazy fit="contain" ratio="1" src="geneidx-schema.png"></va-image>
                        </div>
                        <va-stepper class="flex lg6 md6 sm12 xs12 pipeline-steps" v-model="step" :steps="steps" vertical>
                            <template #step-content-0>
                                <ul>
                                    <li>Download Uniref proteins from taxonomic related species</li>
                                    <li>Build DIAMOND database</li>
                                    <li>Run DIAMOND BLASTx to match proteins sequences with genomes</li>
                                </ul>
                            </template>
                            <template #step-content-1>
                                <ul>
                                    <li>Use matches to estimate coding sections and introns</li>
                                    <li>Compute initial and transition probability matrices </li>
                                    <li>Update the geneid parameter file with the matrices</li>
                                </ul>
                            </template>
                            <template #step-content-2>
                                <ul>
                                    <li>Run geneid using the geneid parameter file and the proteins-genome matches of the above steps</li>
                                </ul>
                            </template>
                        </va-stepper>
                    </va-card>
                </div>
            </div>
        </div>

    </section>
</template>
<script setup lang="ts">
import { ref } from 'vue'

const step = ref(0)

const steps = [
    { label: 'Run DIAMOND BLASTX' },
    { label: 'Estimate genomic regions' },
    { label: 'Run geneid' },
]
</script>
<style scoped>
.pipeline {
    min-height: 100vh;
}
.pipeline-steps {
    padding: 1rem;
}
h2 {
    text-align: center;
}
</style>