#ifndef tcx_h
#define tcx_h

#ifdef __cplusplus
extern "C" {
#endif

const char *call_tcx_api(const char *hex_str);
void clear_err(void);
const char *get_last_err_message(void);
void free_const_string(const char *s);

#ifdef __cplusplus
}
#endif

#endif
