# Imoview API – Complete Endpoint Reference

**Base URL:** `https://api.imoview.com.br/`  
**Version:** 2.0.0.10  
**Auth:** Header `chave` (API key) on all requests. Header `codigoacesso` on `App_` endpoints (from `/Usuario/App_ValidarAcesso`).

**Error codes:** 401 (auth), 403 (business rule), 404 (not found/missing param), 429 (rate limit), 500 (internal).

---

## 1. AUTHENTICATION / USUARIO (23 endpoints)

### GET `/Usuario/App_ValidarAcesso` ⭐ PRIMARY AUTH
- **Summary:** Returns `codigoacesso` token for all `App_` endpoints
- **Params:**
  - `email` (string, required) – User email
  - `senha` (string, required) – MD5-encrypted password
- **Response 200:** `codigousuario`, `nomeusuario`, `cpfusuario`, `perfilusuario`, `cargousuario`, `fotousuario`, permissions (podeverlistaimovel, podeincluirimovel, podeverlistaatendimento, etc.), `equipesaluguel[]`, `equipesVenda[]`, `codigoacesso`, `temadm`, `temY`, `temcaptacao`, `temvistoria`, `temesteira`, `naoexigircpf`, `temfotos60`

### GET `/Usuario/ValidarAcesso`
- **Summary:** Validates user access (client area)
- **Params:** `cpfOuCnpj` (string, req), `senha` (string, req)
- **Response:** codigo, nome, cpfoucnpj, telefones, email, endereco, locatario, comprador, locador, vendedor, quantidadeimoveislocador/vendedor, quantidadecontratoslocatario, quantidadeboletosativoslocatario, temvistoria, temesteira

### GET `/Usuario/RetornarTipo1`
- **Summary:** Client type by CPF/CNPJ
- **Params:** `cpfOuCnpj` (string, req)
- **Response:** codigo, nome, cpfoucnpj, locatario, comprador, locador, vendedor, fiador, parceiro, quantidades...

### GET `/Usuario/RetornarTipo2`
- **Summary:** Client type by client code
- **Params:** `codigoCliente` (integer, req)

### GET `/Usuario/RetornarTipo3`
- **Summary:** Client type list (paginated)
- **Params:** `numeroPagina` (int, req), `numeroRegistros` (int, req), `codigoCliente` (int, opt), `dataHoraInicialUltimaAlteracao` (string, opt), `dataHoraFinalUltimaAlteracao` (string, opt)
- **Response:** quantidade, lista[]

### GET `/Usuario/EnviarCodigoAcesso`
- **Summary:** Sends email with access code for password change
- **Params:** `cpfOuCnpj` (string, req)

### GET `/Usuario/ValidarCodigoAcesso`
- **Summary:** Validates access code for password change
- **Params:** `cpfOuCnpj` (string, req), `codigoAcesso` (string, req)

### POST `/Usuario/AlterarSenha`
- **Summary:** Create/change password (client area)
- **Params:** `cpfOuCnpj` (string, req), `senhaAtual` (string, req), `novaSenha` (string, req)

### GET `/Usuario/App_RetornarDadosAcesso`
- **Summary:** Returns user access data for APP

### GET `/Usuario/App_Logoff`
- **Summary:** Logoff user from APP

### GET `/Usuario/App_VerificarCodigoAcesso`
- **Summary:** Verify access code for APP

### GET `/Usuario/App_RetornarCorretores`
- **Summary:** Returns list of brokers (corretores)

### GET `/Usuario/App_RetornarMQLs`
- **Summary:** Returns list of MQLs

### GET `/Usuario/App_RetornarUsuarios`
- **Summary:** Returns list of users

### GET `/Usuario/App_RetornarDadosUsuario`
- **Summary:** Returns user details

### GET `/Usuario/App_RetornarFilas`
- **Summary:** Returns queues (filas)

### GET `/Usuario/App_RetornarFilasMQL`
- **Summary:** Returns MQL queues

### GET `/Usuario/App_RetornarFilasCaptacao`
- **Summary:** Returns capture queues

### POST `/Usuario/App_AlterarSituacaoFila`
- **Summary:** Change queue status

### POST `/Usuario/App_AlterarSituacaoFilaMQL`
- **Summary:** Change MQL queue status

### POST `/Usuario/App_AlterarSituacaoFilaCaptacao`
- **Summary:** Change capture queue status

### GET `/Usuario/App_RetornarFilasCustomizadas`
- **Summary:** Returns custom queues

### GET `/Usuario/App_RetornarDashboard`
- **Summary:** Returns dashboard data

---

## 2. CLIENTE / PESSOA (7 endpoints) ⭐

### GET `/Cliente/RetornarClientes` ⭐
- **Summary:** Returns client list (paginated)
- **Params:**
  - `numeroPagina` (int, req)
  - `numeroRegistros` (int, req)
  - `tipoPessoa` (int, opt) – Person type filter
  - `tipoRelacionamento` (string, opt) – Relationship type
  - `dataInclusaoInicio` (string, opt)
  - `dataInclusaoFim` (string, opt)
  - `dataHoraInicialUltimaAlteracao` (string, opt)
  - `dataHoraFinalUltimaAlteracao` (string, opt)
  - `ordenacao` (int, opt)
- **Response:** quantidade, lista[]

### GET `/Cliente/App_PesquisarCliente` ⭐
- **Summary:** Search persons in CRM (max 100 records)
- **Params:** `codigoUsuario` (int, req), `textoPesquisa` (string, req)
- **Response:** quantidade, lista[]

### GET `/Cliente/App_RetornarPessoas`
- **Summary:** Search persons for APP/Site
- **Params:** `numeroPagina` (int, req), `numeroRegistros` (int, req), `codigoUsuario` (int, req), `textoPesquisa` (string, opt), `tipoRelacionamento` (string, opt)
- **Response:** quantidade, lista[]

### GET `/Cliente/App_RetornarEmpresas`
- **Summary:** Search companies
- **Params:** `numeroPagina` (int, req), `numeroRegistros` (int, req), `codigoUsuario` (int, req), `textoPesquisa` (string, opt), `tipoRelacionamento` (string, opt)
- **Response:** quantidade, lista[]

### GET `/Cliente/App_RetornarDetalhesCliente` ⭐
- **Summary:** Client detail for APP/Site
- **Params:** `codigoCliente` (int, req), `codigoUsuario` (int, req)
- **Response:** codigo, tipo, nome, fantasia, cpfoucnpj, datanascimento, datafundacao, sexo, estadocivil, naturalidade, nacionalidade, profissao, cargo, rendamensal, rendamensalfamilia, localtrabalho, valorentrada, fgts, conjuge, filiacaopai, filiacaomae, numerofilhos, facebook, linkedin, instagram, telefone, emails[], enderecos[], relacionamentos[], documentos[]

### POST `/Cliente/App_IncluirLead` ⭐
- **Summary:** Insert lead from APP
- **Params:** `codigoUsuario` (int, req), `jsonLead` (object, req)
- **Response:** codigo, nome

### GET `/Cliente/RetornarDadosCliente`
- **Summary:** Returns client data by email or phone
- **Params:** `emailOuTelefone` (string, req)
- **Response:** existe, codigo, nome, codigoatendimento, nomecorretor, emailcorretor

---

## 3. LEADS (9 endpoints) ⭐

### POST `/Lead/IncluirLead` ⭐ MAIN LEAD CREATION
- **Summary:** Insert captured lead
- **Body (LeadIncluir):**
  - `nome` (string) – REQUIRED
  - `telefone` (string) – OPTIONAL (required if no email)
  - `email` (string) – OPTIONAL (required if no phone)
  - `midia` (string) – REQUIRED – Capture media name
  - `finalidade` (string) – OPT – 1=ALUGUEL, 2=VENDA
  - `codigounidade` (string) – OPT – Unit code
  - `codigoimovel` (string) – OPT – Property code
  - `campanha` (string) – OPT
  - `utm` (string) – OPT – Google params
  - `anotacoes` (string) – OPT – Lead's text
  - `emailcorretor` (string) – OPT – Direct to broker (no queue)
- **Response:** mensagem

### POST `/Lead/IncluirAgendamentoVisita` ⭐
- **Summary:** Insert visit scheduling for lead
- **Body:** nome, telefone, email, midia, finalidade, codigounidade, codigoimovel, campanha, utm, anotacoes, emailcorretor, `datahoraagendamentovisita` (string)
- **Response:** mensagem

### POST `/Lead/IncluirLeadCaptacao` ⭐
- **Summary:** Insert capture lead (property acquisition)
- **Body (LeadIncluirCaptacao):** Same as LeadIncluir + destinacao, codigotipoimovel, tipoimovel, valorimovel, valorcondominio, valoriptu, areainterna, areaexterna, arealote, andar, numeroquarto, numerosuite, numerobanho, numerovaga, aceitapermuta, aceitafinanciamento, ocupado, cep, endereco, numeroendereco, complemento, bairro, cidade, estado
- **Response:** mensagem

### POST `/Lead/IncluirAgendamentoVisitaCaptacao`
- **Summary:** Insert visit scheduling for capture lead
- **Body:** Same as LeadIncluirCaptacao
- **Response:** mensagem

### POST `/Lead/IntegrarLeadRdStation`
- **Summary:** Insert lead via RD Station
- **Params:** `codigoConvenio` (int, req), `value` (object, req), `finalidade` (int, opt), `codigoUnidade` (int, opt), `codigoImovel` (int, opt)

### POST `/Lead/IncluirLeadZap`
- **Summary:** Insert lead via ZAP portal
- **Params:** `codigoConvenio` (int, req), `value` (object, req)

### POST `/Lead/IncluirLeadOlx`
- **Summary:** Insert lead via OLX portal
- **Params:** `codigoConvenio` (int, req), `value` (object, req)

### POST `/Lead/IncluirLeadImovelWeb`
- **Summary:** Insert lead via ImovelWeb portal
- **Params:** `codigoConvenio` (int, req), `value` (object, req)

### GET `/Lead/App_RetornarAtendimentos`
- **Summary:** Returns lead's service list
- **Params:** `numeroPagina` (int, req), `numeroRegistros` (int, req), `codigoUsuario` (int, req), `codigoCliente` (int, req)
- **Response:** quantidade, lista[]

---

## 4. IMÓVEIS / PROPERTY (37 endpoints) ⭐

### POST `/Imovel/RetornarImoveisDisponiveis` ⭐ MAIN PROPERTY SEARCH
- **Summary:** Returns available/vacant properties for APP/Site
- **Body tokens (JSON body, documented in description):**
  - `finalidade` (int) – REQUIRED: 1=ALUGUEL, 2=VENDA
  - `numeropagina` (int) – REQUIRED
  - `numeroregistros` (int) – REQUIRED (max 20)
  - `destinacao` (int) – OPT: 1=Residencial, 2=Comercial, 3=Resid+Comerc, 4=Industrial, 5=Rural, 6=Temporada, 7=Corporativa, 8=Comerc+Industrial
  - `codigounidade` (string) – OPT: comma-separated unit codes
  - `codigocondominio` (int) – OPT
  - `codigoproprietario` (int) – OPT
  - `codigocaptador` (int) – OPT
  - `codigosimoveis` (string) – OPT: comma-separated property codes
  - `codigoTipo` (string) – OPT: comma-separated type codes
  - `estado` (string) – OPT: state abbreviation
  - `codigocidade` (int) – OPT
  - `codigoregiao` (int) – OPT
  - `codigosubregiao` (int) – OPT
  - `codigosbairros` (string) – OPT: comma-separated
  - `endereco` (string) – OPT: address search
  - `edificio` (string) – OPT: building name
  - `numeroquartos` (int) – OPT: min (0=all, negative=exact)
  - `numerovagas` (int) – OPT
  - `numerobanhos` (int) – OPT
  - `numerosuite` (int) – OPT
  - `valorde`/`valorate` (decimal) – OPT: price range
  - `valortotalde`/`valortotalate` (decimal) – OPT: total (rent+iptu+condo)
  - `areaprincipalde`/`areaprincipalate` (decimal) – OPT
  - `areade`/`areaate` (decimal) – OPT: internal area range
  - `extras` (string) – OPT: comma-separated extra codes
  - Boolean filters: academia, aceitafinanciamento, aceitapermuta, alarme, arealazer, areaprivativa, areaservico, churrasqueira, closet, dce, exclusivo, interfone, jardim, lavabo, mobiliado, naplanta, piscina, playground, portaoeletronico, portaria24h, quadraesportiva, salaofestas, salaojogos, sauna, varanda, wifi, ocupado, alugado
  - `destaque` (int) – OPT: 1=simple, 2=featured, 3=super featured
  - `opcaoimovel` (int) – OPT: 1=avulsos, 2=lançamentos, 3=unid. lançamentos, 4=avulsos+lanç.mãe
  - `ordenacao` (string) – codigoasc/desc, valorasc/desc, dataatualizacaoasc/desc, datainclusaoasc/desc, destaque, areainternaasc/desc, etc.
  - `retornomapa` (bool) – OPT: map view (max 100, reduced JSON)
  - `naoconsiderarmeusite` (bool) – OPT: ignore "show on my site" filter
  - `identificador` (string) – OPT: property identifier
  - `novosultimos7dias` (bool) – OPT: only last 7 days
- **Response:** quantidade, menorvalor, maiorvalor, menorarea, maiorarea, lista[]

### POST `/Imovel/RetornarImoveis` ⭐
- **Summary:** Returns properties by status
- **Body (ImoveisPorSituacao):** situacao (0=All, 1=Vacant, 2=Rented, 3=Sold, 4=Renovation, 5=Moderation, 6=Disabled, 7=Vacating), finalidade, numeroPagina, numeroRegistros + same tokens as RetornarImoveisDisponiveis
- **Response:** quantidade, menorvalor, maiorvalor, menorarea, maiorarea, lista[]

### Property list item response fields (from RetornarDetalhesImovelDisponivel):
codigo, codigomae, emdesocupacao, empreendimento, empreendimentofilho, nomeempreendimento, siteempreendimento, statusobracodigo/nome, tipolancamentocodigo/nome, codigocondominio, nomecondominio, titulo, metadescription, codigoauxiliar, unidade, nomeunidade, telefoneunidade, emaileunidade, finalidade, codigodestinacao, destinacao, codigotipo, tipo, situacao, valor, valoranterior, valorm2, valorminimo, valormaximo, valorcondominio, valoriptu, valorcondominioeiptu, areainterna, areaexterna, arealote, numeroquartos, numerosuite, numerobanhos, numerovagas, endereco, numero, complemento, bairro, cidade, estado, cep, latitude, longitude, descricao, fotos[], videos[], extras[], captadores[], proprietarios[]...

### GET `/Imovel/RetornarDetalhesImovelDisponivel` ⭐
- **Summary:** Property details (available)
- **Params:** `codigoImovel` (int, req)
- **Response:** Full property object (see above)

### GET `/Imovel/App_RetornarDetalhesImovel`
- **Summary:** Property details for APP
- **Params:** `codigoImovel` (int, req), `codigoUsuario` (int, req)

### POST `/Imovel/RetornarImoveisAlterados`
- **Summary:** Recently changed properties
- **Body:** dataultimaalteracaoinicio, dataultimaalteracaofim, naoconsiderarmeusite, finalidade, numeroPagina, numeroRegistros

### POST `/Imovel/IncluirImovel` ⭐
- **Summary:** Create property
- **Params:** `parametros` (string, req) – JSON string
- **Body (ImovelIncluir schema):**
  - `codigousuario` (int)
  - `codigounidade` (int)
  - `finalidade` (int) – 1=aluguel, 2=venda
  - `destinacao` (int)
  - `codigotipo` (int)
  - `localchave` (int)
  - `valores` { valor, valorcondominio }
  - `areas` { areainterna }
  - `endereco` { rua, numero, complemento, bairro, cidade, estado }
  - `caracteristicasinternas` { numeroquartos }
  - `proprietarios[]` { nome, cpfoucnpj, telefone, percentual }
  - `descricao` (string)
- **Response:** mensagem, codigo

### POST `/Imovel/IncluirAnexo`
- **Summary:** Add attachment to property
- **Params:** `parametros` (string, req)
- **Body:** fotos (string)
- **Response:** mensagem

### Location/Filter Helpers:
| Method | Path | Summary |
|--------|------|---------|
| GET | `/Imovel/RetornarCamposExtrasDisponiveis` | Available extra fields |
| GET | `/Imovel/RetornarTiposImoveisDisponiveis` | Available property types |
| GET | `/Imovel/RetornarTiposImoveisDisponiveisPorDestinacao` | Types by destination |
| POST | `/Imovel/RetornarEstadosDisponiveis` | Available states |
| POST | `/Imovel/RetornarCidadesDisponiveis` | Available cities |
| POST | `/Imovel/RetornarRegioesDisponiveis` | Available regions |
| POST | `/Imovel/RetornarSubRegioesDisponiveis` | Available sub-regions |
| POST | `/Imovel/RetornarBairrosDisponiveis` | Available neighborhoods |
| POST | `/Imovel/PesquisarCidadeEBairrosDisponiveis` | Search cities+neighborhoods+addresses |
| POST | `/Imovel/RetornarCondominiosDisponiveis` | Condominiums list |
| GET | `/Imovel/RetornarDetalhesCondominioDisponivel` | Condominium details |
| GET | `/Imovel/App_PesquisarCidade` | Search cities |
| GET | `/Imovel/App_PesquisarBairro` | Search neighborhoods |
| GET | `/Imovel/App_PesquisarRegiao` | Search regions |
| GET | `/Imovel/App_PesquisarSubRegiao` | Search sub-regions |
| GET | `/Imovel/App_PesquisarCondominio` | Search condominiums |

### Property Management Helpers:
| Method | Path | Summary |
|--------|------|---------|
| GET | `/Imovel/RetornarListaUnidades` | Unit list for property creation |
| GET | `/Imovel/App_RetornarUnidadesLancamento` | Launch units |
| GET | `/Imovel/RetornarListaFinalidades` | Purposes list |
| GET | `/Imovel/RetornarListaDestinacoes` | Destinations list |
| GET | `/Imovel/RetornarListaLocalChaves` | Key locations |
| GET | `/Imovel/RetornarListaQuadros` | Boards list |
| GET | `/Imovel/RetornarListaPosicoes` | Board positions |
| GET | `/Imovel/RetornarListaTiposChaves` | Key types |
| GET | `/Imovel/VerificarImovelPorEndereco` | Check if property exists by address |
| POST | `/Imovel/RetornarImoveisVistoria` | Properties for inspection integration |
| POST | `/Imovel/RetornarHorariosVisitasDisponiveis` | Available visit times |
| POST | `/Imovel/RetornarPortaisImoveis` | Property portal/ads |
| POST | `/Imovel/AlterarPortaisImoveis` | Update property portal/ads |

---

## 5. ATENDIMENTO / SERVICE (33 endpoints) ⭐

### GET `/Atendimento/RetornarAtendimentos` ⭐
- **Summary:** Returns service list (main query endpoint)
- **Params:**
  - `numeroPagina` (int, req), `numeroRegistros` (int, req)
  - `finalidade` (int, req) – 1=aluguel, 2=venda
  - `fase` (int, req) – funnel stage
  - `situacao` (int, opt)
  - `codigoUnidade` (int, opt)
  - `codigoCliente` (int, opt)
  - `codigoCorretor` (int, opt)
  - `codigoMql` (int, opt)
  - `codigoMidia` (int, opt)
  - `codigoTipo` (int, opt)
  - `dataInicial`/`dataFinal` (string, opt)
  - `opcaoAtendimento` (int, opt)
  - `dataHoraInicialUltimaAlteracao`/`dataHoraFinalUltimaAlteracao` (string, opt)
- **Response:** quantidade, lista[]

### GET `/Atendimento/App_RetornarAtendimentos`
- **Summary:** Service list for APP (same + text search, equipe filter)

### GET `/Atendimento/App_DetalhesAtendimentos` ⭐
- **Summary:** Service detail
- **Params:** `codigoUsuario` (int, req), `codigoAtendimento` (int, req)
- **Response:** codigo, finalidade, situacao, funil, funilcodigo, unidadecodigo/nome, tipocodigo/nome, midiacodigo/nome, campanha, utm, termometrocodigo/nome, datahoraentradalead, datahorainclusao, datahoraultimainteracao, datahorarepique, datahora1Resposta, dataprevisaofechamento, datafechamento, quantidadeimoveisencontrados, leadqualificado, lead{}, mql{}, corretor{}, perfil{}, interacoes[]

### POST `/Atendimento/App_IncluirAtendimento` ⭐
- **Summary:** Create service/attendance
- **Params:** `codigoUsuario` (int, req), `jsonAtendimento` (string, req)
- **jsonAtendimento (IncluirAtendimento schema):**
  - `unidadecodigo` (string) – REQUIRED
  - `finalidadecodigo` (string) – REQUIRED: 1=aluguel, 2=venda
  - `tipocodigo` (string) – REQUIRED
  - `midiacodigo` (string) – REQUIRED
  - `leadcodigo` (string) – OPT: existing person code
  - `leadnome` (string) – REQUIRED if new person
  - `leadtelefone` (string) – OPT if email filled
  - `leademail` (string) – OPT if phone filled
  - `termometrocodigo` (string) – OPT: 0=undefined, 1=cold, 2=warm, 3=hot
  - `campanha` (string) – OPT
  - `interacaoinicial` (string) – OPT
  - `imovelcodigo` (string) – OPT: comma-separated
- **Response:** mensagem, fasecodigo, fasenome

### POST `/Atendimento/App_SalvarAtendimento`
- **Summary:** Save service data
- **Params:** codigoUsuario, codigoAtendimento, jsonAtendimento

### POST `/Atendimento/App_SalvarAtendimentoBody`
- **Summary:** Save service (JSON in body)
- **Body (SalvarAtendimento):**
  - `lead` { nome, emailtipocodigo, email }
  - `perfil` { tiposimoveis[{codigo}], cidades[{codigo}] }

### Service Actions:
| Method | Path | Summary |
|--------|------|---------|
| POST | `App_IncluirImovelCarrinho` | Add property to cart |
| POST | `App_ExcluirImovelCarrinho` | Remove property from cart |
| POST | `App_IncluirImovelAgendamentoVisita` | Schedule property visit |
| POST | `App_IncluirImovelVisita` | Register property visit |
| POST | `App_AlterarImovelVisita` | Update property visit |
| POST | `App_ExcluirImovelVisita` | Delete property visit |
| POST | `App_IncluirImovelEmprestimoChave` | Key loan |
| POST | `App_AlterarImovelEmprestimoChave` | Update key loan |
| POST | `App_SalvarParecerVisita` | Save visit feedback |
| POST | `App_IncluirImovelProposta` | Create proposal |
| POST | `App_IncluirNegociacaoImovelProposta` | Create negotiation |
| POST | `App_IncluirReservaImovelProposta` | Create reservation |
| POST | `App_CancelarImovelProposta` | Cancel proposal/reservation |
| POST | `App_DescartarAtendimento` | Discard service |
| POST | `App_IncluirInteracao` | Add interaction |
| POST | `App_IncluirAtividade` | Add activity |
| POST | `App_AlterarCorretor` | Change broker |
| POST | `App_AlterarMQL` | Change MQL |
| POST | `App_Transferir` | Transfer broker |

### Service Queries:
| Method | Path | Summary |
|--------|------|---------|
| POST | `App_RetornarAtendimentosDescartados` | Discarded services |
| GET | `App_RetornarImoveisEncontrados` | Found properties in service |
| GET | `App_RetornarListasAuxiliares` | Auxiliary lists (types, medias, etc.) |
| GET | `App_RetornarImoveisCarrinho` | Cart properties |
| GET | `App_RetornarImoveisVisita` | Visit properties |
| GET | `App_RetornarImoveisProposta` | Proposal properties |
| GET | `App_RetornarImoveisNegocio` | Deal properties |
| GET | `App_RetornarUrlCompartilhamento` | Sharing URL |

### GET `/Atendimento/App_RetornarListasAuxiliares` ⭐
- **Params:** `codigoUsuario` (int, req)
- **Response:** tipostelefone, tiposemail, tiposatendimento, tiposimoveis, tiposendereco, tiposcomplemento, tiposatividade, tiposdocumentospf, tiposdocumentospj, motivosDescarte, motivosParecerGostou, motivosParecerNaoGostou, profissoes, midias, termometros, sexos, extras

---

## 6. LOCADOR / LANDLORD (15 endpoints)

| Method | Path | Summary |
|--------|------|---------|
| GET | `RetornarImoveis` | Landlord's properties |
| GET | `RetornarContratos` | Landlord's contracts |
| GET | `App_RetornarIndicadores` | Property indicators |
| GET | `RetornarExtrato` | Financial statement |
| GET | `App_BaixarExtrato` | Download statement |
| GET | `RetornarDemonstrativoIr` | Income tax report |
| GET | `App_BaixarDemonstrativoIr` | Download tax report |
| POST | `IncluirTicket` | Create support ticket |
| POST | `IncluirInteracaoTicket` | Add ticket interaction |
| GET | `RetornarTicketsAtivos` | Active tickets |
| GET | `RetornarTicketsResolvidos` | Resolved tickets |
| GET | `RetornarDetalhesTicket` | Ticket details |
| GET | `RetornarVistorias` | Inspections |
| GET | `RetornarAmbienteVistoria` | Inspection environment |
| POST | `AlterarConsideracoesVistoria` | Update inspection notes |

---

## 7. LOCATÁRIO / TENANT (22 endpoints)

| Method | Path | Summary |
|--------|------|---------|
| GET | `RetornarImoveis` | Tenant's properties |
| GET | `RetornarContratos` | Tenant's contracts |
| GET | `App_RetornarContratos` | Contracts (APP) |
| GET | `App_RetornarNegocios` | Deals (APP) |
| GET | `RetornarBoletosAtivos` | Active payment slips |
| GET | `RetornarBoletosQuitados` | Paid payment slips |
| POST | `ProrrogarBoletoVencido` | Extend overdue slip |
| GET | `App_BaixarBoleto` | Download payment slip |
| GET | `RetornarTiposTicketsDisponiveis` | Ticket types |
| POST | `IncluirTicket` | Create ticket |
| POST | `IncluirInteracaoTicket` | Add ticket interaction |
| GET | `RetornarTicketsAtivos/Resolvidos` | Active/Resolved tickets |
| GET | `RetornarDetalhesTicket` | Ticket details |
| GET | `RetornarExtrato` | Statement |
| GET | `RetornarVistorias` | Inspections |
| GET | `RetornarAmbienteVistoria` | Inspection env |
| GET | `RetornarItemAmbienteVistoria` | Inspection items |
| POST | `AlterarConsideracoesVistoria` | Update inspection notes |
| POST | `SalvarAvisoDesocupacao` | Save vacancy notice |
| GET | `RetornarMotivosRescisaoContratoAluguel` | Termination reasons |
| GET | `RetornarResumoRescisao` | Termination summary |

---

## 8. VENDEDOR / SELLER (2 endpoints)

| Method | Path | Summary |
|--------|------|---------|
| GET | `/Vendedor/RetornarImoveis` | Seller's properties |
| GET | `/Vendedor/App_RetornarIndicadores` | Property indicators |

---

## 9. COMPRADOR / BUYER (3 endpoints)

| Method | Path | Summary |
|--------|------|---------|
| GET | `/Comprador/RetornarNegocios` | Buyer's deals |
| GET | `/Comprador/App_RetornarNegocios` | Deals (APP) |
| GET | `/Comprador/App_RetornarContratos` | Sale contracts (APP) |

---

## 10. VISTORIA / INSPECTION (18 endpoints)

Key endpoints:
- GET `App_RetornarLista` – List inspections
- GET `App_RetornarDetalhes` – Inspection details
- POST `App_IncluirVistoria` – Create inspection
- POST `App_IniciarVistoria` – Start inspection
- POST `App_ConcluirVistoria` – Complete inspection
- GET `App_BaixarLaudo` – Download report

---

## 11. AGENDA / CALENDAR (7 endpoints)

| Method | Path | Summary |
|--------|------|---------|
| GET | `RetornarAtividades` | List activities |
| GET | `RetornarDetalhesAtividade` | Activity details |
| GET | `RetornarTiposAtividades` | Activity types |
| POST | `IncluirAtividade` | Create activity |
| POST | `IncluirNota` | Add note |
| POST | `ExcluirAtividade` | Delete activity |
| POST | `RealizarAtividade` | Complete activity |

---

## 12. MOVIMENTO / FINANCIAL (3 endpoints)

| Method | Path | Summary |
|--------|------|---------|
| GET | `RetornarMovimentos` | List financial movements |
| GET | `RetornarDetalhesMovimento` | Movement details |
| GET | `RetornarTiposGarantias` | Guarantee types |

---

## 13. OTHER

### Boleto
- GET `/Boleto/RetornarBoletos` – Payment slips

### Contrato Aluguel
- GET `/ContratoAluguel/RetornarContratos` – Rental contracts

### Fiador / Guarantor
- GET `/Fiador/App_RetornarContratos` – Guarantor contracts
- GET `/Fiador/App_RetornarNegocios` – Guarantor deals

### Sindico / Building Manager
- GET `/Sindico/App_RetornarImoveis` – Manager's properties

---

## KEY ENUMS REFERENCE

**finalidade:** 1=Aluguel(Rent), 2=Venda(Sale)

**destinacao:** 1=Residencial, 2=Comercial, 3=Resid+Comerc, 4=Industrial, 5=Rural, 6=Temporada, 7=Corporativa, 8=Comerc+Industrial

**situacao (imóvel):** 0=All, 1=Vago/Disponível, 2=Alugado, 3=Vendido, 4=Em reforma, 5=Em moderação, 6=Desativado, 7=Em desocupação

**termometro:** 0=Indefinido, 1=Frio(Cold), 2=Morno(Warm), 3=Quente(Hot)

**destaque:** 1=Simples, 2=Destaque, 3=Super Destaque

**opcaoImovel:** 1=Avulsos, 2=Lançamentos, 3=Unidades de Lançamentos, 4=Avulsos+Lançamentos Mãe

---

## TOTAL: 163 endpoints across 14 categories
