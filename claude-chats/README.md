# Claude Code chats

Is project par jo Claude Code chats hui hain, wo yahan `sessions/` folder mein rakhi jati hain, taake doosre computer par bhi khul sakein.

## Chats bhejne wala (export)

Project folder mein ye chalayein:

```powershell
powershell -ExecutionPolicy Bypass -File claude-chats\export-chats.ps1
```

## Chats lene wala (import)

1. Project ko **isi path par** rakhein: `C:\xampp\htdocs\invoice-demo-crm`
2. Project folder mein ye chalayein:

   ```powershell
   powershell -ExecutionPolicy Bypass -File claude-chats\import-chats.ps1
   ```

3. VS Code mein project kholein. Phir Claude Code mein **past conversations** kholein aur chat chun lein. Terminal mein `claude --resume` bhi chala sakte hain.

> Note: chat files mein poori baat cheet hoti hai, yani commands, file content aur errors. Share karne se pehle check kar lein ke un mein koi password ya API key na ho.
