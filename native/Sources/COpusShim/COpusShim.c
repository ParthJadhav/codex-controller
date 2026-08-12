#include "COpusShim.h"

#include <dlfcn.h>
#include <stdlib.h>

enum {
    DS_OPUS_APPLICATION_AUDIO = 2049,
    DS_OPUS_SET_BITRATE_REQUEST = 4002,
    DS_OPUS_SET_VBR_REQUEST = 4006,
    DS_OPUS_SET_COMPLEXITY_REQUEST = 4010,
    DS_OPUS_SET_EXPERT_FRAME_DURATION_REQUEST = 4040,
    DS_OPUS_FRAMESIZE_10_MS = 5003,
};

typedef void *(*opus_encoder_create_fn)(int32_t, int32_t, int32_t, int32_t *);
typedef int32_t (*opus_encode_fn)(void *, const int16_t *, int32_t, uint8_t *, int32_t);
typedef int32_t (*opus_encoder_ctl_fn)(void *, int32_t, ...);
typedef void (*opus_encoder_destroy_fn)(void *);
typedef void *(*opus_decoder_create_fn)(int32_t, int32_t, int32_t *);
typedef int32_t (*opus_decode_fn)(void *, const uint8_t *, int32_t, int16_t *, int32_t, int32_t);
typedef void (*opus_decoder_destroy_fn)(void *);

struct DSOpusEncoder {
    void *library;
    void *encoder;
    opus_encode_fn encode;
    opus_encoder_destroy_fn destroy;
};

struct DSOpusDecoder {
    void *library;
    void *decoder;
    opus_decode_fn decode;
    opus_decoder_destroy_fn destroy;
};

static void *open_opus(void) {
    static const char *candidates[] = {
        "/opt/homebrew/lib/libopus.dylib",
        "/usr/local/lib/libopus.dylib",
        "libopus.0.dylib",
        "libopus.dylib",
    };
    for (size_t index = 0; index < sizeof(candidates) / sizeof(candidates[0]); ++index) {
        void *library = dlopen(candidates[index], RTLD_NOW | RTLD_LOCAL);
        if (library != NULL) {
            return library;
        }
    }
    return NULL;
}

DSOpusEncoder *ds_opus_encoder_create(int32_t *error) {
    if (error != NULL) {
        *error = -7;
    }
    void *library = open_opus();
    if (library == NULL) {
        return NULL;
    }

    opus_encoder_create_fn create =
        (opus_encoder_create_fn)dlsym(library, "opus_encoder_create");
    opus_encode_fn encode = (opus_encode_fn)dlsym(library, "opus_encode");
    opus_encoder_ctl_fn control =
        (opus_encoder_ctl_fn)dlsym(library, "opus_encoder_ctl");
    opus_encoder_destroy_fn destroy =
        (opus_encoder_destroy_fn)dlsym(library, "opus_encoder_destroy");
    if (create == NULL || encode == NULL || control == NULL || destroy == NULL) {
        dlclose(library);
        return NULL;
    }

    int32_t opus_error = 0;
    void *opus_encoder = create(48000, 2, DS_OPUS_APPLICATION_AUDIO, &opus_error);
    if (opus_encoder == NULL || opus_error != 0) {
        if (error != NULL) {
            *error = opus_error;
        }
        dlclose(library);
        return NULL;
    }

    int32_t control_error = control(opus_encoder, DS_OPUS_SET_BITRATE_REQUEST, 160000);
    if (control_error == 0) {
        control_error = control(opus_encoder, DS_OPUS_SET_VBR_REQUEST, 0);
    }
    if (control_error == 0) {
        control_error = control(opus_encoder, DS_OPUS_SET_COMPLEXITY_REQUEST, 5);
    }
    if (control_error == 0) {
        control_error = control(
            opus_encoder,
            DS_OPUS_SET_EXPERT_FRAME_DURATION_REQUEST,
            DS_OPUS_FRAMESIZE_10_MS
        );
    }
    if (control_error != 0) {
        if (error != NULL) {
            *error = control_error;
        }
        destroy(opus_encoder);
        dlclose(library);
        return NULL;
    }

    DSOpusEncoder *result = calloc(1, sizeof(DSOpusEncoder));
    if (result == NULL) {
        destroy(opus_encoder);
        dlclose(library);
        return NULL;
    }
    result->library = library;
    result->encoder = opus_encoder;
    result->encode = encode;
    result->destroy = destroy;
    if (error != NULL) {
        *error = 0;
    }
    return result;
}

int32_t ds_opus_encode(
    DSOpusEncoder *encoder,
    const int16_t *samples,
    int32_t frame_size,
    uint8_t *output,
    int32_t output_capacity
) {
    if (encoder == NULL || samples == NULL || output == NULL) {
        return -1;
    }
    return encoder->encode(
        encoder->encoder,
        samples,
        frame_size,
        output,
        output_capacity
    );
}

void ds_opus_encoder_destroy(DSOpusEncoder *encoder) {
    if (encoder == NULL) {
        return;
    }
    encoder->destroy(encoder->encoder);
    dlclose(encoder->library);
    free(encoder);
}

DSOpusDecoder *ds_opus_decoder_create(int32_t *error) {
    if (error != NULL) {
        *error = -7;
    }
    void *library = open_opus();
    if (library == NULL) {
        return NULL;
    }
    opus_decoder_create_fn create =
        (opus_decoder_create_fn)dlsym(library, "opus_decoder_create");
    opus_decode_fn decode = (opus_decode_fn)dlsym(library, "opus_decode");
    opus_decoder_destroy_fn destroy =
        (opus_decoder_destroy_fn)dlsym(library, "opus_decoder_destroy");
    if (create == NULL || decode == NULL || destroy == NULL) {
        dlclose(library);
        return NULL;
    }

    int32_t opus_error = 0;
    void *opus_decoder = create(48000, 1, &opus_error);
    if (opus_decoder == NULL || opus_error != 0) {
        if (error != NULL) {
            *error = opus_error;
        }
        dlclose(library);
        return NULL;
    }
    DSOpusDecoder *result = calloc(1, sizeof(DSOpusDecoder));
    if (result == NULL) {
        destroy(opus_decoder);
        dlclose(library);
        return NULL;
    }
    result->library = library;
    result->decoder = opus_decoder;
    result->decode = decode;
    result->destroy = destroy;
    if (error != NULL) {
        *error = 0;
    }
    return result;
}

int32_t ds_opus_decode(
    DSOpusDecoder *decoder,
    const uint8_t *input,
    int32_t input_length,
    int16_t *samples,
    int32_t frame_capacity
) {
    if (decoder == NULL || input == NULL || samples == NULL) {
        return -1;
    }
    return decoder->decode(
        decoder->decoder,
        input,
        input_length,
        samples,
        frame_capacity,
        0
    );
}

void ds_opus_decoder_destroy(DSOpusDecoder *decoder) {
    if (decoder == NULL) {
        return;
    }
    decoder->destroy(decoder->decoder);
    dlclose(decoder->library);
    free(decoder);
}
