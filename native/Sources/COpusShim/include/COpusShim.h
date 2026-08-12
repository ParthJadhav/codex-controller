#ifndef C_OPUS_SHIM_H
#define C_OPUS_SHIM_H

#include <stdint.h>

typedef struct DSOpusEncoder DSOpusEncoder;
typedef struct DSOpusDecoder DSOpusDecoder;

DSOpusEncoder *ds_opus_encoder_create(int32_t *error);
int32_t ds_opus_encode(
    DSOpusEncoder *encoder,
    const int16_t *samples,
    int32_t frame_size,
    uint8_t *output,
    int32_t output_capacity
);
void ds_opus_encoder_destroy(DSOpusEncoder *encoder);

DSOpusDecoder *ds_opus_decoder_create(int32_t *error);
int32_t ds_opus_decode(
    DSOpusDecoder *decoder,
    const uint8_t *input,
    int32_t input_length,
    int16_t *samples,
    int32_t frame_capacity
);
void ds_opus_decoder_destroy(DSOpusDecoder *decoder);

#endif
