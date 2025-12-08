import uvicorn

if __name__ == "__main__":
	# Executa o servidor com reload desativado para manter uma única thread/processo
	uvicorn.run("backend.main:app", host="0.0.0.0", port=8000, reload=False)


 