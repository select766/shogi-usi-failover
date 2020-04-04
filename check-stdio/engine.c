#include <stdio.h>
#include <string.h>
#ifdef _WIN32
#include <windows.h>
#else
#include <unistd.h>
#endif

int main()
{
    char line_buffer[2048];
    char cmd_buffer[2048];
    int stop_write = 0;
    while(1)
    {
        if (fgets(line_buffer, sizeof(line_buffer), stdin) == NULL)
        {
            // 終端
            break;
        }
        sscanf(line_buffer, "%s", cmd_buffer);//最初のスペースまでをコマンドとみなす
        if (strcmp(cmd_buffer, "echo") == 0)
        {
            // line_bufferは改行文字で終わっている
            if (!stop_write)
            {
                fputs(line_buffer, stdout);
                fflush(stdout);
            }
        }
        else if (strcmp(cmd_buffer, "stop-read") == 0)
        {
            // readをせず終了もしない
            while (1)
            {
#ifdef _WIN32
                Sleep(1000);
#else
                sleep(1);
#endif
            }
        }
        else if (strcmp(cmd_buffer, "stop-write") == 0)
        {
            // 今後writeしない
            stop_write = 1;
        }
        else if (strcmp(cmd_buffer, "exit") == 0)
        {
            // 終了
            return 1;
        }
    }
}
