<template>
    <section class="row hero justify-center align-center">
        <div class="flex">
            <va-card-content>
                <div class="hero-heading">
                    <h1 class="va-h1">geneid</h1>
                    <p>Predict genic elements as splice sites, exons or genes, along eukaryotic DNA sequences</p>
                    <va-card-actions class="hero-cta" align="center">
                        <va-button color="secondary" icon="ion-logo-github">
                            More info
                        </va-button>
                        <va-button color="primary">
                            Try it now
                        </va-button>
                    </va-card-actions>
                </div>
                <div class="row justify-space-between hero-features">
                    <article v-for="(feature, index) in geneidFeatures" :key="index" class="flex lg3 md6 xs6">
                        <div class="row align-center justify-center feature-icon">
                            <div class="flex">
                                <va-icon size="3rem" color="primary" :name="feature.icon"></va-icon>
                            </div>
                        </div>
                        <div class="row align-center justify-center">
                            <va-dropdown :stick-to-edges="true" class="feature-dp flex">
                                <template #anchor>
                                    <va-button preset="secondary" color="#ffff">
                                        {{ feature.title }}
                                    </va-button>
                                </template>
                                <va-dropdown-content class="feature-dp-content">
                                    {{ feature.description }}
                                </va-dropdown-content>
                            </va-dropdown>
                        </div>
                    </article>
                </div>
            </va-card-content>
            <!-- <va-divider /> -->
        </div>
        <!-- 
            geneid description and repo
            geneid+blastx description and repo
            annotated species
            pipeline description and repo ?
            tanomy explorer
            geneid form
            genome browser
            download annotations
         -->

    </section>
</template>
<script setup lang="ts">

const geneidFeatures = [
    {
        icon: 'fa-bolt',
        title: 'Optimized speed and memory usage',
        description: 'geneid is very efficient in terms of speed and memory usage. In practice, geneid can analyze chromosome size sequences at a rate of about 1 Gbp per hour on the Intel(R) Xeon CPU 2.80 Ghz. For the largest human chromosome (chr1), it requires 1/2 Gbyte of RAM plus the size of the Fasta sequence'
    },
    {
        icon: 'fa-bullseye',
        title: 'Accuracy',
        description: 'geneid compares to that of other existing "ab initio" gene prediction tools'
    },
    {
        icon: 'fa-shuffle',
        title: 'Multiple sources integration',
        description: 'geneid offers support to integrate predictions from multiple sources (ESTs, blast HSPs) and to reannotate genomic sequences, via external gff files and together with the redefinition of the "gene model"'
    },
    {
        icon: 'fa-gear',
        title: 'Output customization',
        description: 'geneid output can be customized to different levels of detail, including exhaustive listing of potential signals and exons. Furthermore, several output formats as gff or XML are available'
    }
]



</script>
<style scoped>
.feature-dp-content {
    max-width: 50%
}

.hero-heading {
    padding: 1rem;
}

.feature-icon {
    padding: 1rem
}

.row>.flex>.card {
    height: 100%
}

h1,
p {
    text-align: center;
    /* padding: 1rem; */
    color: var(--va-text-inverted);
}

.hero {
    height: 100vh;
    background-color: var(--va-secondary)
}
</style>