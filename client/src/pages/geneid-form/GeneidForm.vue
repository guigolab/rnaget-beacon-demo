<template>
    <div class="row">
        <div class="flex">
            <va-card>
                <va-card-title>
                    <va-button-toggle v-model="fastaInput" :options="[
                        { label: 'Upload Fasta File', value: 'fastaFile' },
                        { label: 'Insert Fasta Text', value: 'fastaText' }
                    ]" />
                </va-card-title>
                <va-card-content v-if="fastaInput === 'fastaText'">
                    <va-input v-model="fastaText" type="textarea" label="FASTA" placeholder="Paste your fasta here" />
                </va-card-content>
                <va-card-content v-else>
                    <va-file-upload v-model="fastaFile" />
                </va-card-content>
            </va-card>
        </div>
    </div>
    <div class="row">
        <div class="flex">
            <va-card>
                <va-card-title>
                    <va-button-toggle v-model="gffInput" :options="[
                        { label: 'Upload GFF File', value: 'gffFile' },
                        { label: 'Insert GFF Text', value: 'gffText' }
                    ]" />
                </va-card-title>
                <va-card-content v-if="gffInput === 'gffText'">
                    <va-input v-model="gfftext" type="textarea" label="GFF"
                        placeholder="Paste your GFF here (tab separeted)" />
                </va-card-content>
                <va-card-content v-else>
                    <va-file-upload v-model="gffFile" />
                </va-card-content>
            </va-card>
        </div>
    </div>
</template>
<script setup lang="ts">

</script>