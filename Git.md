# 1. Inicializar um repositório
git init

# 2. Configurar usuário (uma vez só)
git config --global user.name "Seu Nome"
git config --global user.email "seuemail@exemplo.com"

# 3. Verificar mudanças
git status

# 4. Adicionar arquivos ao commit
git add .
# ou
git add arquivo.py

# 5. Criar um commit
git commit -m "mensagem explicando o que mudou"

# 6. Ver histórico de commits
git log
git log --oneline   # histórico compacto

# 7. Enviar para o GitHub
git push -u origin main   # primeira vez
git push                  # depois

# 8. Baixar atualizações do remoto
git pull

# 9. Criar um branch
git branch nome_da_branch

# 10. Mudar para um branch
git checkout nome_da_branch

# Criar e mudar ao mesmo tempo
git checkout -b nome_da_branch

# 11. Ver branches existentes
git branch

# 12. Fazer merge de um branch com o outro
git checkout main
git merge nome_da_branch

# 13. Clonar um repositório
git clone https://github.com/usuario/repositorio.git

# 14. Ver últimas modificações
git diff
git diff arquivo.py

# 15. Remover arquivos do versionamento
git rm nome_arquivo

# 16. Desfazer alterações
git checkout -- nome_do_arquivo           # volta arquivo ao último commit
git reset --hard HEAD                     # reseta tudo ao último commit

# 17. Adicionar repositório remoto
git remote add origin https://github.com/usuario/repositorio.git

# Ver remotos
git remote -v

# 18. Atualizar URL do remoto
git remote set-url origin nova_url

# 19. Ver arquivos ignorados
git check-ignore -v *

# RESUMÃO DO DIA A DIA
git status
git add .
git commit -m "mensagem"
git push
