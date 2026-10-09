// Шрифты IBM Plex из @fontsource: файлы попадают в сборку и грузятся с того же
// источника, что и приложение. Подключены только латиница и кириллица (в нее
// входят украинские буквы и «№») и только начертания, которые использует CSS.
// Браузер скачивает файл шрифта, когда на странице появляется текст этим
// шрифтом, поэтому лишние начертания стоят только места в сборке.

// Sans переменный: CSS использует веса от 500 до 780, статические файлы
// покрыли бы их грубее. Вес выше 700 браузер ограничит максимумом шрифта.
import '@fontsource-variable/ibm-plex-sans/wght.css'

// Mono — редактор и метки замены: обычный, курсив и полужирный в разметке
// Markdown, 500 — метки и счетчики.
import '@fontsource/ibm-plex-mono/latin-400.css'
import '@fontsource/ibm-plex-mono/cyrillic-400.css'
import '@fontsource/ibm-plex-mono/latin-400-italic.css'
import '@fontsource/ibm-plex-mono/cyrillic-400-italic.css'
import '@fontsource/ibm-plex-mono/latin-500.css'
import '@fontsource/ibm-plex-mono/cyrillic-500.css'
import '@fontsource/ibm-plex-mono/latin-700.css'
import '@fontsource/ibm-plex-mono/cyrillic-700.css'

// Serif — текст договора в редакторе и результате (этап 7 плана редизайна).
import '@fontsource/ibm-plex-serif/latin-400.css'
import '@fontsource/ibm-plex-serif/cyrillic-400.css'
import '@fontsource/ibm-plex-serif/latin-400-italic.css'
import '@fontsource/ibm-plex-serif/cyrillic-400-italic.css'
import '@fontsource/ibm-plex-serif/latin-600.css'
import '@fontsource/ibm-plex-serif/cyrillic-600.css'
