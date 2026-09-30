# efi-conv als Validierungsdienst.
#
# Der Vertrag verlangt Pruefung „mit efi-conv check oder unter direkter Nutzung
# derselben Validierungslogik". Statt die Logik nachzubauen, laeuft hier das
# echte Paket und die Node-Anwendung fragt es ueber HTTP.
FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends git \
 && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir fastapi "uvicorn[standard]"
# Dasselbe efi-conv wie in Leistungspaket A — referenziert, nicht nachgebaut.
# Ueber die Bauargumente laesst sich auf den Paket-A-Fork oder einen festen
# Commit zeigen, damit Konverter und Importer dieselbe Pruefung benutzen:
#   docker compose build --build-arg EFI_CONV_REPO=github.com/andreaskasper/avefi-converter.git \
#                        --build-arg EFI_CONV_REF=main efi-conv
ARG EFI_CONV_REPO=github.com/AV-EFI/efi-conv.git
ARG EFI_CONV_REF=main
RUN pip install --no-cache-dir "efi-conv @ git+https://${EFI_CONV_REPO}@${EFI_CONV_REF}" \
 && python -c "import importlib.metadata as m; print('efi-conv', m.version('efi-conv'))"
# Schema einmal beim Bauen holen und im Image einfrieren. Ohne das laedt
# efi-conv es zur Laufzeit vom main-Branch — dann ist keine Konvertierung
# reproduzierbar, weil sich das Schema unter der laufenden Anwendung aendert.
RUN python -c "from efi_conv.core import check; check.get_schema_validator()" \
 && ls -l /root/.cache/efi_conv/

WORKDIR /app
COPY service.py test_service.py /app/
EXPOSE 8000
CMD ["uvicorn", "service:app", "--host", "0.0.0.0", "--port", "8000"]
